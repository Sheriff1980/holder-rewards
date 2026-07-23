import type { Env } from "./types.js";

const MAX_CURRENCY_ICON_BYTES = 512 * 1024;
const MAX_BRAND_LOGO_BYTES = 1024 * 1024;

type AssetRow = {
  content_type: string;
  data: ArrayBuffer;
  updated_at: string;
};

type StoredAssetRow = Omit<AssetRow, "data"> & {
  data: number[];
};

export class AssetError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function detectedImageType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const header = new TextDecoder("ascii").decode(bytes.slice(0, 12));
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) return "image/gif";
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

async function validatedImage(file: File, maxBytes: number): Promise<{ data: ArrayBuffer; contentType: string }> {
  if (file.size < 1 || file.size > maxBytes) {
    throw new AssetError(`Choose an image smaller than ${Math.floor(maxBytes / 1024)} KB.`);
  }
  const data = await file.arrayBuffer();
  const contentType = detectedImageType(new Uint8Array(data));
  if (!contentType) throw new AssetError("Choose a PNG, JPEG, GIF, or WebP image.");
  return { data, contentType };
}

export async function saveCurrencyIcon(env: Env, guildId: string, file: File): Promise<void> {
  const { data, contentType } = await validatedImage(file, MAX_CURRENCY_ICON_BYTES);
  await env.DB.prepare(
    `INSERT INTO guild_assets (guild_id, asset_type, content_type, data, updated_at)
     VALUES (?, 'currency_icon', ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(guild_id, asset_type) DO UPDATE SET
       content_type = excluded.content_type,
       data = excluded.data,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(guildId, contentType, data)
    .run();
}

export async function getCurrencyIcon(env: Env, guildId: string): Promise<AssetRow | null> {
  const row = await env.DB.prepare(
    "SELECT content_type, data, updated_at FROM guild_assets WHERE guild_id = ? AND asset_type = 'currency_icon'"
  )
    .bind(guildId)
    .first<StoredAssetRow>();
  return row ? { ...row, data: Uint8Array.from(row.data).buffer } : null;
}

export async function hasCurrencyIcon(env: Env, guildId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS found FROM guild_assets WHERE guild_id = ? AND asset_type = 'currency_icon'"
  )
    .bind(guildId)
    .first<{ found: number }>();
  return row?.found === 1;
}

export async function removeCurrencyIcon(env: Env, guildId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    "DELETE FROM guild_assets WHERE guild_id = ? AND asset_type = 'currency_icon'"
  )
    .bind(guildId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export function currencyIconUrl(origin: string, guildId: string): string {
  return new URL(`/assets/currency/${guildId}`, origin).toString();
}

export async function saveBrandLogo(env: Env, guildId: string, file: File): Promise<void> {
  const { data, contentType } = await validatedImage(file, MAX_BRAND_LOGO_BYTES);
  await env.DB.prepare(
    `INSERT INTO guild_brand_assets (guild_id, content_type, data, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(guild_id) DO UPDATE SET
       content_type = excluded.content_type,
       data = excluded.data,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(guildId, contentType, data)
    .run();
}

export async function getBrandLogo(env: Env, guildId: string): Promise<AssetRow | null> {
  const row = await env.DB.prepare(
    "SELECT content_type, data, updated_at FROM guild_brand_assets WHERE guild_id = ?"
  )
    .bind(guildId)
    .first<StoredAssetRow>();
  return row ? { ...row, data: Uint8Array.from(row.data).buffer } : null;
}

export async function hasBrandLogo(env: Env, guildId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS found FROM guild_brand_assets WHERE guild_id = ?")
    .bind(guildId)
    .first<{ found: number }>();
  return row?.found === 1;
}

export async function removeBrandLogo(env: Env, guildId: string): Promise<boolean> {
  const result = await env.DB.prepare("DELETE FROM guild_brand_assets WHERE guild_id = ?")
    .bind(guildId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export function brandLogoUrl(origin: string, guildId: string): string {
  return new URL(`/assets/brand/${guildId}`, origin).toString();
}
