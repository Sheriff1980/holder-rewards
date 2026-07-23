import type { Env } from "./types.js";

const MAX_METADATA_BYTES = 256 * 1024;
const CACHE_LIFETIME_MS = 24 * 60 * 60 * 1000;

export type NftAttribute = { name: string; value: string };

type CacheRow = { attributes: string; expires_at: string };

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.includes(":") ||
    /^127\./.test(normalized) ||
    /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^169\.254\./.test(normalized) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(normalized)
  );
}

export function normalizeMetadataUrl(uri: string): URL {
  if (uri.startsWith("ipfs://")) {
    const path = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
    if (!path || path.includes("..")) throw new Error("The NFT returned an invalid IPFS URI.");
    return new URL(`https://ipfs.io/ipfs/${path}`);
  }
  if (uri.startsWith("ar://")) {
    const transactionId = uri.slice("ar://".length);
    if (!/^[a-zA-Z0-9_-]{20,100}$/.test(transactionId)) {
      throw new Error("The NFT returned an invalid Arweave URI.");
    }
    return new URL(`https://arweave.net/${transactionId}`);
  }

  const url = new URL(uri);
  if (url.protocol !== "https:" || url.username || url.password || isPrivateHostname(url.hostname)) {
    throw new Error("NFT metadata must use a public HTTPS, IPFS, or Arweave URL.");
  }
  return url;
}

export function parseMetadataAttributes(metadata: unknown): NftAttribute[] {
  if (!metadata || typeof metadata !== "object") return [];
  const record = metadata as Record<string, unknown>;
  const raw = Array.isArray(record.attributes)
    ? record.attributes
    : Array.isArray(record.traits)
      ? record.traits
      : [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const attribute = item as Record<string, unknown>;
    const name = attribute.trait_type ?? attribute.name;
    const value = attribute.value;
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > 100 ||
      (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
    ) {
      return [];
    }
    return [{ name, value: String(value) }];
  });
}

export function metadataHasTrait(
  attributes: NftAttribute[],
  traitName: string,
  traitValue: string
): boolean {
  return attributes.some(
    (attribute) => attribute.name === traitName && attribute.value === traitValue
  );
}

function parseDataUri(uri: string): unknown {
  if (uri.length > MAX_METADATA_BYTES * 2) throw new Error("Inline NFT metadata is too large.");
  const match = /^data:application\/json(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(uri);
  if (!match) throw new Error("Only JSON data URIs are supported for inline NFT metadata.");
  const encoded = match[2] ?? "";
  const text = match[1]
    ? new TextDecoder().decode(Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)))
    : decodeURIComponent(encoded);
  if (new TextEncoder().encode(text).byteLength > MAX_METADATA_BYTES) {
    throw new Error("Inline NFT metadata is too large.");
  }
  return JSON.parse(text) as unknown;
}

async function fetchMetadata(uri: string): Promise<unknown> {
  if (uri.startsWith("data:")) return parseDataUri(uri);

  let url = normalizeMetadataUrl(uri);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(url, { redirect: "manual", signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("Location");
        if (!location) throw new Error("NFT metadata returned an invalid redirect.");
        url = normalizeMetadataUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) throw new Error(`NFT metadata request failed (${response.status}).`);
      const declaredSize = Number(response.headers.get("Content-Length") ?? 0);
      if (declaredSize > MAX_METADATA_BYTES) throw new Error("NFT metadata is too large.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_METADATA_BYTES) throw new Error("NFT metadata is too large.");
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("NFT metadata redirected too many times.");
}

export async function loadTokenAttributes(
  env: Env,
  chainId: string,
  contractAddress: string,
  tokenId: bigint,
  tokenUri: string
): Promise<NftAttribute[]> {
  const cached = await env.DB.prepare(
    `SELECT attributes, expires_at FROM nft_metadata_cache
     WHERE chain_id = ? AND contract_address = ? AND token_id = ?`
  )
    .bind(chainId, contractAddress, tokenId.toString())
    .first<CacheRow>();
  if (cached && Date.parse(cached.expires_at) > Date.now()) {
    try {
      return JSON.parse(cached.attributes) as NftAttribute[];
    } catch {
      // Replace malformed cache data with a fresh metadata response.
    }
  }

  const attributes = parseMetadataAttributes(await fetchMetadata(tokenUri));
  await env.DB.prepare(
    `INSERT INTO nft_metadata_cache
      (chain_id, contract_address, token_id, attributes, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(chain_id, contract_address, token_id) DO UPDATE SET
       attributes = excluded.attributes,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      chainId,
      contractAddress,
      tokenId.toString(),
      JSON.stringify(attributes),
      new Date(Date.now() + CACHE_LIFETIME_MS).toISOString()
    )
    .run();
  return attributes;
}
