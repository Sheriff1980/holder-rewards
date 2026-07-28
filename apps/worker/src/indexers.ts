import { listChains } from "./chains.js";
import { parseMetadataAttributes, type NftAttribute } from "./metadata.js";
import type { Env } from "./types.js";

const INDEXER_TIMEOUT_MS = 5_000;
const MAX_INDEXED_PAGES = 10;

export type IndexedNft = {
  tokenId: string;
  attributes: NftAttribute[];
};

export type IndexerConfig = {
  chainId: string;
  url: string;
};

type IndexerConfigRow = {
  chain_id: string;
  url: string;
};

export class IndexerConfigError extends Error {}

function parseIndexerUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 200) {
    throw new IndexerConfigError("Indexer URL must be an HTTPS URL.");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new IndexerConfigError("Indexer URL must be an HTTPS URL without embedded credentials.");
    }
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    if (error instanceof IndexerConfigError) throw error;
    throw new IndexerConfigError("Indexer URL must be a valid HTTPS URL.");
  }
}

export async function listIndexerConfigs(env: Env): Promise<IndexerConfig[]> {
  const rows = await env.DB.prepare(
    "SELECT chain_id, url FROM indexer_configs WHERE enabled = 1 ORDER BY chain_id"
  ).all<IndexerConfigRow>();
  return rows.results.map((row) => ({ chainId: row.chain_id, url: row.url }));
}

export async function getIndexerUrl(env: Env, chainId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT url FROM indexer_configs WHERE chain_id = ? AND enabled = 1"
  )
    .bind(chainId)
    .first<{ url: string }>();
  return row?.url ?? null;
}

export async function saveIndexerConfig(
  env: Env,
  input: { chainId: unknown; url: unknown }
): Promise<IndexerConfig> {
  if (typeof input.chainId !== "string") {
    throw new IndexerConfigError("Choose a chain for this indexer.");
  }
  const chain = (await listChains(env)).find((candidate) => candidate.id === input.chainId);
  if (!chain) {
    throw new IndexerConfigError("Choose an enabled chain for this indexer.");
  }
  const url = parseIndexerUrl(input.url);
  await env.DB.prepare(
    `INSERT INTO indexer_configs (chain_id, url, enabled, updated_at)
     VALUES (?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(chain_id) DO UPDATE SET
       url = excluded.url,
       enabled = 1,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(chain.id, url)
    .run();
  return { chainId: chain.id, url };
}

export async function removeIndexerConfig(env: Env, chainId: unknown): Promise<boolean> {
  if (typeof chainId !== "string") return false;
  const result = await env.DB.prepare(
    "UPDATE indexer_configs SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE chain_id = ? AND enabled = 1"
  )
    .bind(chainId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

type AlchemyOwnedNftsResponse = {
  ownedNfts?: Array<{
    tokenId?: unknown;
    raw?: { metadata?: unknown };
  }>;
  pageKey?: unknown;
};

async function fetchIndexerPage(url: URL): Promise<AlchemyOwnedNftsResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INDEXER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`NFT indexer returned ${response.status}.`);
    return (await response.json()) as AlchemyOwnedNftsResponse;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("NFT indexer timed out after 5 seconds.", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchIndexedNftsForOwner(
  indexerUrl: string,
  owner: string,
  contractAddress: string
): Promise<IndexedNft[]> {
  const nfts: IndexedNft[] = [];
  let pageKey: string | undefined;
  for (let page = 0; page < MAX_INDEXED_PAGES; page += 1) {
    const url = new URL(`${indexerUrl}/getNFTsForOwner`);
    url.searchParams.set("owner", owner);
    url.searchParams.append("contractAddresses[]", contractAddress);
    url.searchParams.set("withMetadata", "true");
    url.searchParams.set("pageSize", "100");
    if (pageKey) url.searchParams.set("pageKey", pageKey);

    const body = await fetchIndexerPage(url);
    if (!Array.isArray(body.ownedNfts)) {
      throw new Error("NFT indexer returned an invalid response.");
    }
    for (const nft of body.ownedNfts) {
      if (typeof nft.tokenId !== "string") continue;
      try {
        nfts.push({
          tokenId: BigInt(nft.tokenId).toString(),
          attributes: parseMetadataAttributes(nft.raw?.metadata)
        });
      } catch {
        // Skip tokens whose IDs the indexer returned in an unexpected format.
      }
    }
    pageKey =
      typeof body.pageKey === "string" && body.pageKey.length > 0 && body.pageKey.length < 500
        ? body.pageKey
        : undefined;
    if (!pageKey) break;
  }
  return nfts;
}

export type DasAsset = {
  mintAddress: string;
  attributes: NftAttribute[];
};

type DasAssetsResponse = {
  result?: {
    total?: number;
    items?: Array<{
      id?: unknown;
      grouping?: Array<{ group_key?: unknown; group_value?: unknown }>;
      content?: { metadata?: unknown };
    }>;
  };
  error?: { message?: string };
};

const DAS_PAGE_LIMIT = 1000;

async function fetchDasOwnerPage(
  dasUrl: string,
  owner: string,
  page: number
): Promise<NonNullable<DasAssetsResponse["result"]>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INDEXER_TIMEOUT_MS);
  try {
    const response = await fetch(dasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "getAssetsByOwner",
        params: { ownerAddress: owner, page, limit: DAS_PAGE_LIMIT }
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Solana indexer returned ${response.status}.`);
    const body = (await response.json()) as DasAssetsResponse;
    if (body.error || !body.result || !Array.isArray(body.result.items)) {
      throw new Error(body.error?.message ?? "Solana indexer returned an invalid response.");
    }
    return body.result;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Solana indexer timed out after 5 seconds.", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchDasCollectionAssets(
  dasUrl: string,
  owners: string[],
  collectionAddress: string
): Promise<DasAsset[]> {
  const assets: DasAsset[] = [];
  for (const owner of owners) {
    for (let page = 1; page <= MAX_INDEXED_PAGES; page += 1) {
      const result = await fetchDasOwnerPage(dasUrl, owner, page);
      for (const item of result.items ?? []) {
        const inCollection = Array.isArray(item.grouping) && item.grouping.some(
          (group) => group.group_key === "collection" && group.group_value === collectionAddress
        );
        if (!inCollection || typeof item.id !== "string") continue;
        assets.push({
          mintAddress: item.id,
          attributes: parseMetadataAttributes(item.content?.metadata)
        });
      }
      const total = typeof result.total === "number" ? result.total : 0;
      if (page * DAS_PAGE_LIMIT >= total) break;
    }
  }
  return assets;
}
