import { describe, expect, it } from "vitest";
import { BUILTIN_CHAINS, type ChainDefinition } from "@holder-rewards/chains";
import { checkChainProvider } from "../src/health.js";

function chain(overrides: Partial<ChainDefinition> = {}): ChainDefinition {
  return {
    id: "apechain",
    family: "evm",
    name: "ApeChain",
    chainReference: "33139",
    nativeCurrencySymbol: "APE",
    defaultRpcUrl: "https://rpc.example",
    builtin: true,
    ...overrides
  };
}

describe("chain provider health", () => {
  it("uses a keyless Solana default that supports ownership lookups", () => {
    expect(BUILTIN_CHAINS.find(({ id }) => id === "solana")?.defaultRpcUrl).toBe(
      "https://api.mainnet-beta.solana.com"
    );
  });

  it("uses a keyless Base default that does not require an operator account", () => {
    expect(BUILTIN_CHAINS.find(({ id }) => id === "base")?.defaultRpcUrl).toBe(
      "https://base-rpc.publicnode.com"
    );
  });

  it("accepts an EVM provider only when its chain ID matches", async () => {
    const healthy = await checkChainProvider(
      chain(),
      async () => Response.json({ jsonrpc: "2.0", id: 1, result: `0x${(33139).toString(16)}` })
    );
    expect(healthy).toMatchObject({ status: "healthy", family: "evm" });

    const wrongNetwork = await checkChainProvider(
      chain(),
      async () => Response.json({ jsonrpc: "2.0", id: 1, result: "0x1" })
    );
    expect(wrongNetwork).toMatchObject({
      status: "unhealthy",
      message: "Wrong network: expected chain 33139, received 1."
    });
  });

  it("uses Solana getHealth and accepts only an ok result", async () => {
    let requestedMethod = "";
    const result = await checkChainProvider(
      chain({
        id: "solana",
        family: "solana",
        name: "Solana",
        chainReference: "mainnet-beta",
        nativeCurrencySymbol: "SOL"
      }),
      async (_input, init) => {
        requestedMethod = String(JSON.parse(String(init?.body)).method);
        return Response.json({ jsonrpc: "2.0", id: 1, result: "ok" });
      }
    );
    expect(requestedMethod).toBe("getHealth");
    expect(result.status).toBe("healthy");
  });

  it("reports missing configuration and unreachable providers without exposing URLs", async () => {
    await expect(
      checkChainProvider(chain({ defaultRpcUrl: undefined }))
    ).resolves.toMatchObject({
      status: "unconfigured",
      message: "No public RPC is configured."
    });

    const unreachable = await checkChainProvider(chain(), async () => {
      throw new Error("secret provider details");
    });
    expect(unreachable).toMatchObject({
      status: "unhealthy",
      message: "Provider could not be reached."
    });
    expect(JSON.stringify(unreachable)).not.toContain("secret provider details");
    expect(JSON.stringify(unreachable)).not.toContain("rpc.example");
  });

  it("reports HTTP and RPC errors in plain language", async () => {
    await expect(
      checkChainProvider(chain(), async () => new Response("rate limited", { status: 429 }))
    ).resolves.toMatchObject({
      status: "unhealthy",
      message: "Provider returned HTTP 429."
    });
    await expect(
      checkChainProvider(
        chain(),
        async () => Response.json({ jsonrpc: "2.0", id: 1, error: { message: "internal" } })
      )
    ).resolves.toMatchObject({
      status: "unhealthy",
      message: "Provider rejected the health check."
    });
  });
});
