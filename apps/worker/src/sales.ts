import { getAddress, isAddress } from "viem";
import { shortWalletAddress } from "./audit.js";
import { accentColorNumber, getGuildBranding } from "./branding.js";
import { listChains } from "./chains.js";
import { fetchNftImage, fetchNftSales, getIndexerUrl, type NftSale } from "./indexers.js";
import type { ChainDefinition } from "@holder-rewards/chains";
import type { Env } from "./types.js";

const MAX_POSTS_PER_WATCH = 5;
const SALES_PAGE_LIMIT = 25;

export type SalesWatch = {
  id: string;
  guildId: string;
  chainId: string;
  contractAddress: string;
  channelId: string;
  lastSeenBlock: number;
  lastError: string | null;
};

export type DiscordTextChannel = {
  id: string;
  name: string;
};

export class SalesWatchError extends Error {}

type SalesWatchRow = {
  id: string;
  guild_id: string;
  chain_id: string;
  contract_address: string;
  channel_id: string;
  last_seen_block: number | string;
  last_error: string | null;
};

function parseWatch(row: SalesWatchRow): SalesWatch | null {
  const lastSeenBlock = Number(row.last_seen_block);
  if (!Number.isSafeInteger(lastSeenBlock) || lastSeenBlock < 0) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    chainId: row.chain_id,
    contractAddress: row.contract_address,
    channelId: row.channel_id,
    lastSeenBlock,
    lastError: row.last_error
  };
}

export async function listSalesWatches(env: Env, guildId?: string): Promise<SalesWatch[]> {
  const rows = guildId
    ? await env.DB.prepare(
        `SELECT id, guild_id, chain_id, contract_address, channel_id, last_seen_block, last_error
         FROM sales_watches WHERE guild_id = ? AND enabled = 1 ORDER BY created_at`
      )
        .bind(guildId)
        .all<SalesWatchRow>()
    : await env.DB.prepare(
        `SELECT id, guild_id, chain_id, contract_address, channel_id, last_seen_block, last_error
         FROM sales_watches WHERE enabled = 1 ORDER BY created_at`
      ).all<SalesWatchRow>();
  return rows.results.map(parseWatch).filter((watch): watch is SalesWatch => watch !== null);
}

export async function createSalesWatch(
  env: Env,
  input: {
    guildId: unknown;
    chainId: unknown;
    contractAddress: unknown;
    channelId: unknown;
    createdBy: string;
  }
): Promise<SalesWatch> {
  if (typeof input.guildId !== "string" || !/^[0-9]{15,22}$/.test(input.guildId)) {
    throw new SalesWatchError("Server must be a valid Discord ID.");
  }
  const chain = (await listChains(env)).find((candidate) => candidate.id === input.chainId);
  if (!chain || chain.family !== "evm") {
    throw new SalesWatchError("Choose an EVM network for this sales watch.");
  }
  if (!(await getIndexerUrl(env, chain.id))) {
    throw new SalesWatchError(
      `Add an NFT indexer URL for ${chain.name} under Advanced network settings before starting a sales watch.`
    );
  }
  if (typeof input.contractAddress !== "string" || !isAddress(input.contractAddress)) {
    throw new SalesWatchError("Collection must be a valid EVM contract address.");
  }
  const contractAddress = getAddress(input.contractAddress);
  if (typeof input.channelId !== "string" || !/^[0-9]{15,22}$/.test(input.channelId)) {
    throw new SalesWatchError("Choose a Discord channel for sale posts.");
  }
  const existing = (await listSalesWatches(env, input.guildId)).find(
    (watch) =>
      watch.chainId === chain.id &&
      watch.contractAddress.toLowerCase() === contractAddress.toLowerCase()
  );
  if (existing) {
    throw new SalesWatchError("That collection is already being watched in this server.");
  }

  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(input.guildId),
    env.DB.prepare(
      `INSERT INTO sales_watches (id, guild_id, chain_id, contract_address, channel_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, input.guildId, chain.id, contractAddress, input.channelId, input.createdBy)
  ]);
  return {
    id,
    guildId: input.guildId,
    chainId: chain.id,
    contractAddress,
    channelId: input.channelId,
    lastSeenBlock: 0,
    lastError: null
  };
}

export async function removeSalesWatch(env: Env, guildId: string, watchId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE sales_watches SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ? AND enabled = 1"
  )
    .bind(watchId, guildId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function listTextChannels(env: Env, guildId: string): Promise<DiscordTextChannel[]> {
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (!response.ok) {
    throw new SalesWatchError(`Discord channels could not be loaded (${response.status}).`);
  }
  const channels = (await response.json()) as Array<{ id?: unknown; name?: unknown; type?: unknown }>;
  if (!Array.isArray(channels)) {
    throw new SalesWatchError("Discord returned an unexpected channel list.");
  }
  return channels
    .filter((channel) => channel.type === 0 && typeof channel.id === "string" && typeof channel.name === "string")
    .map((channel) => ({ id: channel.id as string, name: channel.name as string }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function updateWatchState(
  env: Env,
  watchId: string,
  lastSeenBlock: number,
  lastError: string | null
): Promise<void> {
  await env.DB.prepare(
    "UPDATE sales_watches SET last_seen_block = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  )
    .bind(lastSeenBlock, lastError, watchId)
    .run();
}

async function currentBlockNumber(rpcUrl: string | undefined): Promise<number> {
  if (!rpcUrl) return 0;
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) return 0;
    const body = (await response.json()) as { result?: unknown };
    if (typeof body.result !== "string" || !/^0x[0-9a-f]+$/i.test(body.result)) return 0;
    return Number(BigInt(body.result));
  } catch {
    return 0;
  }
}

async function postSaleToDiscord(
  env: Env,
  watch: SalesWatch,
  chain: ChainDefinition,
  indexerUrl: string,
  sale: NftSale
): Promise<void> {
  const [meta, branding] = await Promise.all([
    fetchNftImage(indexerUrl, watch.contractAddress, sale.tokenId),
    getGuildBranding(env, watch.guildId)
  ]);
  const priceText = sale.priceValue
    ? ` for ${sale.priceValue}${sale.priceSymbol ? ` ${sale.priceSymbol}` : ""}`
    : "";
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  if (sale.marketplace) fields.push({ name: "Marketplace", value: sale.marketplace, inline: true });
  if (sale.sellerAddress) fields.push({ name: "Seller", value: shortWalletAddress(sale.sellerAddress), inline: true });
  if (sale.buyerAddress) fields.push({ name: "Buyer", value: shortWalletAddress(sale.buyerAddress), inline: true });

  const embed: Record<string, unknown> = {
    title: `${meta.name ?? `NFT #${sale.tokenId}`} sold${priceText}`,
    color: accentColorNumber(branding.accentColor),
    fields
  };
  if (chain.explorerUrl) embed.url = `${chain.explorerUrl}/tx/${sale.transactionHash}`;
  if (meta.imageUrl) embed.thumbnail = { url: meta.imageUrl };

  const response = await fetch(`https://discord.com/api/v10/channels/${watch.channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ embeds: [embed] })
  });
  if (!response.ok) {
    throw new Error(`Discord rejected the sale post (${response.status}).`);
  }
}

async function pollWatch(env: Env, watch: SalesWatch, chains: ChainDefinition[]): Promise<number> {
  const indexerUrl = await getIndexerUrl(env, watch.chainId);
  if (!indexerUrl) {
    throw new Error("No NFT indexer URL is configured for the watched chain.");
  }
  const chain = chains.find((candidate) => candidate.id === watch.chainId);
  if (!chain) {
    throw new Error("The watched chain is no longer enabled.");
  }

  if (watch.lastSeenBlock === 0) {
    const latest = await fetchNftSales(indexerUrl, watch.contractAddress, 0, 1, "desc");
    const cursor = latest[0]?.blockNumber ?? (await currentBlockNumber(chain.defaultRpcUrl));
    await updateWatchState(env, watch.id, cursor, null);
    return 0;
  }

  const sales = await fetchNftSales(
    indexerUrl,
    watch.contractAddress,
    watch.lastSeenBlock + 1,
    SALES_PAGE_LIMIT,
    "asc"
  );
  let posted = 0;
  let cursor = watch.lastSeenBlock;
  for (const sale of sales) {
    cursor = Math.max(cursor, sale.blockNumber);
    if (posted < MAX_POSTS_PER_WATCH) {
      await postSaleToDiscord(env, watch, chain, indexerUrl, sale);
      posted += 1;
    }
  }
  await updateWatchState(env, watch.id, cursor, null);
  return posted;
}

export async function pollSalesWatches(
  env: Env
): Promise<{ checked: number; posted: number; errors: number }> {
  const [watches, chains] = await Promise.all([listSalesWatches(env), listChains(env)]);
  let posted = 0;
  let errors = 0;
  for (const watch of watches) {
    try {
      posted += await pollWatch(env, watch, chains);
    } catch (error) {
      errors += 1;
      await updateWatchState(
        env,
        watch.id,
        watch.lastSeenBlock,
        error instanceof Error ? error.message.slice(0, 300) : "Sales check failed."
      ).catch(() => undefined);
    }
  }
  return { checked: watches.length, posted, errors };
}
