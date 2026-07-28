import type { ChainDefinition } from "./chain-registry.js";
import { listChains } from "./chains.js";
import { listIndexerConfigs } from "./indexers.js";
import type { Env } from "./types.js";

export type ChainHealthStatus = "healthy" | "unhealthy" | "unconfigured";

export type ChainHealth = {
  id: string;
  name: string;
  family: "evm" | "solana";
  status: ChainHealthStatus;
  message: string;
  latencyMs: number;
};

type RpcResponse = {
  result?: unknown;
  error?: { message?: string };
};

export async function checkChainProvider(
  chain: ChainDefinition,
  request: typeof fetch = fetch
): Promise<ChainHealth> {
  const startedAt = Date.now();
  const result = (
    status: ChainHealthStatus,
    message: string
  ): ChainHealth => ({
    id: chain.id,
    name: chain.name,
    family: chain.family as "evm" | "solana",
    status,
    message,
    latencyMs: Math.max(0, Date.now() - startedAt)
  });

  if ((chain.family !== "evm" && chain.family !== "solana") || !chain.defaultRpcUrl) {
    return result("unconfigured", "No public RPC is configured.");
  }

  const method = chain.family === "evm" ? "eth_chainId" : "getHealth";
  try {
    const response = await request(chain.defaultRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params: [] }),
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) {
      return result("unhealthy", `Provider returned HTTP ${response.status}.`);
    }
    const body = (await response.json()) as RpcResponse;
    if (body.error) return result("unhealthy", "Provider rejected the health check.");

    if (chain.family === "solana") {
      return body.result === "ok"
        ? result("healthy", "Solana RPC is healthy.")
        : result("unhealthy", "Solana RPC reported that it is behind.");
    }

    if (
      typeof body.result !== "string" ||
      !/^0x[0-9a-f]+$/i.test(body.result) ||
      !/^[1-9][0-9]*$/.test(chain.chainReference)
    ) {
      return result("unhealthy", "Provider returned an invalid chain ID.");
    }
    const actualChainId = BigInt(body.result).toString();
    if (actualChainId !== chain.chainReference) {
      return result(
        "unhealthy",
        `Wrong network: expected chain ${chain.chainReference}, received ${actualChainId}.`
      );
    }
    return result("healthy", "EVM RPC is healthy and on the correct network.");
  } catch {
    return result("unhealthy", "Provider could not be reached.");
  }
}

export async function checkIndexerProvider(
  chain: ChainDefinition,
  indexerUrl: string,
  request: typeof fetch = fetch
): Promise<ChainHealth> {
  const startedAt = Date.now();
  const result = (
    status: ChainHealthStatus,
    message: string
  ): ChainHealth => ({
    id: `${chain.id}-indexer`,
    name: `${chain.name} indexer`,
    family: chain.family as "evm" | "solana",
    status,
    message,
    latencyMs: Math.max(0, Date.now() - startedAt)
  });

  try {
    if (chain.family === "solana") {
      const response = await request(indexerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: crypto.randomUUID(),
          method: "getAssetsByOwner",
          params: { ownerAddress: "11111111111111111111111111111111", page: 1, limit: 1 }
        }),
        signal: AbortSignal.timeout(5_000)
      });
      if (!response.ok) return result("unhealthy", `Indexer returned HTTP ${response.status}.`);
      const body = (await response.json()) as { result?: { items?: unknown }; error?: { message?: string } };
      if (body.error || !Array.isArray(body.result?.items)) {
        return result("unhealthy", "Endpoint does not serve Solana DAS (getAssetsByOwner) requests.");
      }
      return result("healthy", "Solana DAS indexer is reachable.");
    }

    const url = new URL(`${indexerUrl}/getNFTsForOwner`);
    url.searchParams.set("owner", "0x0000000000000000000000000000000000000000");
    url.searchParams.set("pageSize", "1");
    const response = await request(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return result("unhealthy", `Indexer returned HTTP ${response.status}.`);
    const body = (await response.json()) as { ownedNfts?: unknown };
    if (!Array.isArray(body.ownedNfts)) {
      return result("unhealthy", "Endpoint is not an Alchemy-compatible NFT API.");
    }
    return result("healthy", "NFT indexer is reachable.");
  } catch {
    return result("unhealthy", "Indexer could not be reached.");
  }
}

export async function checkChainProviders(env: Env): Promise<ChainHealth[]> {
  const chains = (await listChains(env)).filter(
    (chain) => chain.family === "evm" || chain.family === "solana"
  );
  const indexers = await listIndexerConfigs(env);
  const chainById = new Map(chains.map((chain) => [chain.id, chain]));
  return Promise.all([
    ...chains.map((chain) => checkChainProvider(chain)),
    ...indexers.flatMap((indexer) => {
      const chain = chainById.get(indexer.chainId);
      return chain ? [checkIndexerProvider(chain, indexer.url)] : [];
    })
  ]);
}
