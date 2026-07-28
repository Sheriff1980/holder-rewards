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

export type NftSale = {
  tokenId: string;
  marketplace: string | null;
  buyerAddress: string | null;
  sellerAddress: string | null;
  priceValue: string | null;
  priceSymbol: string | null;
  transactionHash: string;
  blockNumber: number;
};

type AlchemySalesResponse = {
  nftSales?: Array<{
    tokenId?: unknown;
    marketplace?: unknown;
    buyerAddress?: unknown;
    sellerAddress?: unknown;
    price?: { value?: unknown; paymentToken?: { symbol?: unknown } };
    transactionHash?: unknown;
    blockNumber?: unknown;
  }>;
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function fetchNftSales(
  indexerUrl: string,
  contractAddress: string,
  fromBlock: number,
  limit: number,
  order: "asc" | "desc" = "asc"
): Promise<NftSale[]> {
  const url = new URL(`${indexerUrl}/getNFTSales`);
  url.searchParams.set("contractAddress", contractAddress);
  url.searchParams.set("fromBlock", String(fromBlock));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order", order);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INDEXER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`NFT sales indexer returned ${response.status}.`);
    const body = (await response.json()) as AlchemySalesResponse;
    if (!Array.isArray(body.nftSales)) {
      throw new Error("NFT sales indexer returned an invalid response.");
    }
    return body.nftSales.flatMap((sale) => {
      const tokenId = optionalString(sale.tokenId);
      const transactionHash = optionalString(sale.transactionHash);
      const blockNumber = Number(sale.blockNumber);
      if (!tokenId || !transactionHash || !Number.isSafeInteger(blockNumber) || blockNumber < 0) {
        return [];
      }
      return [{
        tokenId,
        marketplace: optionalString(sale.marketplace),
        buyerAddress: optionalString(sale.buyerAddress),
        sellerAddress: optionalString(sale.sellerAddress),
        priceValue: optionalString(sale.price?.value),
        priceSymbol: optionalString(sale.price?.paymentToken?.symbol),
        transactionHash,
        blockNumber
      }];
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("NFT sales indexer timed out after 5 seconds.", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchNftImage(
  indexerUrl: string,
  contractAddress: string,
  tokenId: string
): Promise<{ name: string | null; imageUrl: string | null }> {
  const url = new URL(`${indexerUrl}/getNFTMetadata`);
  url.searchParams.set("contractAddress", contractAddress);
  url.searchParams.set("tokenId", tokenId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INDEXER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { name: null, imageUrl: null };
    const body = (await response.json()) as {
      name?: unknown;
      image?: { thumbnailUrl?: unknown; cachedUrl?: unknown; originalUrl?: unknown };
    };
    return {
      name: optionalString(body.name),
      imageUrl:
        optionalString(body.image?.thumbnailUrl) ??
        optionalString(body.image?.cachedUrl) ??
        optionalString(body.image?.originalUrl)
    };
  } catch {
    return { name: null, imageUrl: null };
  } finally {
    clearTimeout(timeout);
  }
}
