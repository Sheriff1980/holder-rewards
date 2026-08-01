import { currencyIconUrl, hasCurrencyIcon } from "./assets.js";
import { accentColorNumber, getGuildBranding } from "./branding.js";
import { getRewardSettings } from "./points.js";
import type { Raffle } from "./raffles.js";
import type { StoreItem } from "./store.js";
import type { Env } from "./types.js";

type RewardsChannelRow = {
  rewards_channel_id: string | null;
  store_panel_message_id: string | null;
  raffle_panel_message_id: string | null;
};

export type RewardsChannelSettings = {
  channelId: string | null;
  storePanelMessageId: string | null;
  rafflePanelMessageId: string | null;
};

export class AnnouncementError extends Error {}

export async function getRewardsChannelSettings(
  env: Env,
  guildId: string
): Promise<RewardsChannelSettings> {
  const row = await env.DB.prepare(
    `SELECT rewards_channel_id, store_panel_message_id, raffle_panel_message_id
     FROM guild_settings WHERE guild_id = ?`
  )
    .bind(guildId)
    .first<RewardsChannelRow>();
  return {
    channelId: row?.rewards_channel_id ?? null,
    storePanelMessageId: row?.store_panel_message_id ?? null,
    rafflePanelMessageId: row?.raffle_panel_message_id ?? null
  };
}

async function discordMessage(
  env: Env,
  channelId: string,
  body: Record<string, unknown>,
  messageId?: string | null
): Promise<string> {
  const editUrl = messageId
    ? `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`
    : `https://discord.com/api/v10/channels/${channelId}/messages`;
  const response = await fetch(editUrl, {
    method: messageId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    if (messageId && response.status === 404) return discordMessage(env, channelId, body);
    throw new AnnouncementError(
      `Discord could not post in that channel (${response.status}). Give the bot View Channel, Send Messages, and Embed Links permissions.`
    );
  }
  const message = (await response.json()) as { id?: unknown };
  if (typeof message.id !== "string") throw new AnnouncementError("Discord did not return the posted message.");
  return message.id;
}

async function panelBody(
  env: Env,
  guildId: string,
  origin: string,
  kind: "store" | "raffles"
): Promise<Record<string, unknown>> {
  const [branding, rewards, iconAvailable] = await Promise.all([
    getGuildBranding(env, guildId),
    getRewardSettings(env, guildId),
    hasCurrencyIcon(env, guildId)
  ]);
  const store = kind === "store";
  return {
    embeds: [{
      title: `${branding.name} ${store ? "Store" : "Raffles"}`,
      description: store
        ? `Spend your ${rewards.currencyName} on available community rewards.`
        : `Use your ${rewards.currencyName} to enter active community raffles.`,
      color: accentColorNumber(branding.accentColor),
      ...(iconAvailable ? { thumbnail: { url: currencyIconUrl(origin, guildId) } } : {})
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 1,
        label: store ? "Browse Store" : "View Raffles",
        custom_id: `rewards:open:${kind}`
      }]
    }]
  };
}

export async function configureRewardsChannel(
  env: Env,
  guildId: string,
  channelId: string,
  origin: string
): Promise<RewardsChannelSettings> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(guildId),
    env.DB.prepare(
      "INSERT INTO guild_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING"
    ).bind(guildId)
  ]);
  const current = await getRewardsChannelSettings(env, guildId);
  const sameChannel = current.channelId === channelId;
  const [storePanelMessageId, rafflePanelMessageId] = await Promise.all([
    discordMessage(
      env,
      channelId,
      await panelBody(env, guildId, origin, "store"),
      sameChannel ? current.storePanelMessageId : null
    ),
    discordMessage(
      env,
      channelId,
      await panelBody(env, guildId, origin, "raffles"),
      sameChannel ? current.rafflePanelMessageId : null
    )
  ]);
  await env.DB.prepare(
    `UPDATE guild_settings SET rewards_channel_id = ?, store_panel_message_id = ?,
       raffle_panel_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`
  )
    .bind(channelId, storePanelMessageId, rafflePanelMessageId, guildId)
    .run();
  return { channelId, storePanelMessageId, rafflePanelMessageId };
}

export async function announceStoreItem(
  env: Env,
  guildId: string,
  origin: string,
  item: StoreItem
): Promise<boolean> {
  const settings = await getRewardsChannelSettings(env, guildId);
  if (!settings.channelId) return false;
  const [branding, rewards, iconAvailable] = await Promise.all([
    getGuildBranding(env, guildId),
    getRewardSettings(env, guildId),
    hasCurrencyIcon(env, guildId)
  ]);
  await discordMessage(env, settings.channelId, {
    embeds: [{
      title: `New in the ${branding.name} Store: ${item.title}`,
      description: item.description || "A new community reward is available.",
      color: accentColorNumber(branding.accentColor),
      ...(iconAvailable ? { thumbnail: { url: currencyIconUrl(origin, guildId) } } : {}),
      fields: [
        { name: "Price", value: `${item.price.toLocaleString()} ${rewards.currencyName}`, inline: true },
        { name: "Availability", value: item.stock === null ? "Unlimited" : `${item.stock.toLocaleString()} available`, inline: true }
      ]
    }],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: "Open Store", custom_id: "rewards:open:store" }] }]
  });
  return true;
}

export async function announceRaffle(
  env: Env,
  guildId: string,
  origin: string,
  raffle: Raffle
): Promise<boolean> {
  const settings = await getRewardsChannelSettings(env, guildId);
  if (!settings.channelId) return false;
  const [branding, rewards, iconAvailable] = await Promise.all([
    getGuildBranding(env, guildId),
    getRewardSettings(env, guildId),
    hasCurrencyIcon(env, guildId)
  ]);
  await discordMessage(env, settings.channelId, {
    embeds: [{
      title: `New ${branding.name} Raffle: ${raffle.title}`,
      description: raffle.prize,
      color: accentColorNumber(branding.accentColor),
      ...(iconAvailable ? { thumbnail: { url: currencyIconUrl(origin, guildId) } } : {}),
      fields: [
        { name: "Entry cost", value: `${raffle.entryCost.toLocaleString()} ${rewards.currencyName}`, inline: true },
        { name: "Maximum entries", value: raffle.maxEntriesPerMember.toLocaleString(), inline: true }
      ]
    }],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: "View Raffle", custom_id: "rewards:open:raffles" }] }]
  });
  return true;
}
