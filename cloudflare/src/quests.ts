import { getPointsBalance } from "./points.js";
import { getDiscordMemberRoles } from "./rules.js";
import type { Env } from "./types.js";

export type QuestKind = "link_wallet" | "hold_role" | "daily_claims" | "code";

export type QuestConfig = {
  roleId?: string;
  days?: number;
  codeHash?: string;
};

export type Quest = {
  id: string;
  guildId: string;
  title: string;
  kind: QuestKind;
  config: QuestConfig;
  reward: number;
};

export type QuestWithStatus = Quest & { completed: boolean };

export type QuestCheckResult = "completed" | "already_completed" | "not_met";

export class QuestError extends Error {}

const QUEST_KINDS = new Set<QuestKind>(["link_wallet", "hold_role", "daily_claims", "code"]);

type QuestRow = {
  id: string;
  guild_id: string;
  title: string;
  kind: string;
  config: string;
  reward: number;
};

function parseQuest(row: QuestRow): Quest | null {
  if (!QUEST_KINDS.has(row.kind as QuestKind) || !Number.isSafeInteger(row.reward) || row.reward < 1) {
    return null;
  }
  let config: QuestConfig;
  try {
    const parsed = JSON.parse(row.config) as Partial<QuestConfig>;
    config = {
      roleId: typeof parsed.roleId === "string" ? parsed.roleId : undefined,
      days: Number.isSafeInteger(parsed.days) ? Number(parsed.days) : undefined,
      codeHash: typeof parsed.codeHash === "string" ? parsed.codeHash : undefined
    };
  } catch {
    return null;
  }
  if (row.kind === "hold_role" && !config.roleId) return null;
  if (row.kind === "daily_claims" && !config.days) return null;
  if (row.kind === "code" && !config.codeHash) return null;
  return { id: row.id, guildId: row.guild_id, title: row.title, kind: row.kind as QuestKind, config, reward: row.reward };
}

function requireSnowflake(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9]{15,22}$/.test(value)) {
    throw new QuestError(`${label} must be a valid Discord ID.`);
  }
  return value;
}

async function hashQuestCode(code: string): Promise<string> {
  const normalized = code.trim().toLowerCase().replace(/\s+/g, " ");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listQuests(env: Env, guildId: string): Promise<Quest[]> {
  const rows = await env.DB.prepare(
    "SELECT id, guild_id, title, kind, config, reward FROM quests WHERE guild_id = ? AND enabled = 1 ORDER BY created_at"
  )
    .bind(guildId)
    .all<QuestRow>();
  return rows.results.map(parseQuest).filter((quest): quest is Quest => quest !== null);
}

export async function listQuestsWithStatus(
  env: Env,
  guildId: string,
  discordUserId: string
): Promise<QuestWithStatus[]> {
  const [quests, completions] = await Promise.all([
    listQuests(env, guildId),
    env.DB.prepare(
      "SELECT quest_id FROM quest_completions WHERE guild_id = ? AND discord_user_id = ?"
    )
      .bind(guildId, discordUserId)
      .all<{ quest_id: string }>()
  ]);
  const completed = new Set(completions.results.map((row) => row.quest_id));
  return quests.map((quest) => ({ ...quest, completed: completed.has(quest.id) }));
}

export async function createQuest(
  env: Env,
  input: {
    guildId: unknown;
    title: unknown;
    kind: unknown;
    reward: unknown;
    roleId?: unknown;
    days?: unknown;
    code?: unknown;
  }
): Promise<Quest> {
  const guildId = requireSnowflake(input.guildId, "Server");
  if (typeof input.title !== "string" || input.title.trim().length < 2 || input.title.trim().length > 80) {
    throw new QuestError("Quest title must be between 2 and 80 characters.");
  }
  const title = input.title.trim();
  if (!QUEST_KINDS.has(input.kind as QuestKind)) {
    throw new QuestError("Choose a quest type.");
  }
  const kind = input.kind as QuestKind;
  const reward = Number(input.reward);
  if (!Number.isSafeInteger(reward) || reward < 1 || reward > 1_000_000) {
    throw new QuestError("Quest reward must be a whole number between 1 and 1,000,000.");
  }

  const config: QuestConfig = {};
  if (kind === "hold_role") {
    config.roleId = requireSnowflake(input.roleId, "Role");
  }
  if (kind === "daily_claims") {
    const days = Number(input.days);
    if (!Number.isSafeInteger(days) || days < 2 || days > 365) {
      throw new QuestError("Daily claim days must be a whole number between 2 and 365.");
    }
    config.days = days;
  }
  if (kind === "code") {
    if (typeof input.code !== "string" || input.code.trim().length < 4 || input.code.trim().length > 100) {
      throw new QuestError("The secret code must be between 4 and 100 characters.");
    }
    config.codeHash = await hashQuestCode(input.code);
  }

  const quest: Quest = { id: crypto.randomUUID(), guildId, title, kind, config, reward };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(guildId),
    env.DB.prepare(
      "INSERT INTO quests (id, guild_id, title, kind, config, reward) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(quest.id, guildId, title, kind, JSON.stringify(config), reward)
  ]);
  return quest;
}

export async function removeQuest(env: Env, guildId: string, questId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE quests SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ? AND enabled = 1"
  )
    .bind(questId, guildId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

async function completeQuest(
  env: Env,
  quest: Quest,
  discordUserId: string
): Promise<"completed" | "already_completed"> {
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO quest_completions (quest_id, guild_id, discord_user_id) VALUES (?, ?, ?)"
  )
    .bind(quest.id, quest.guildId, discordUserId)
    .run();
  if ((inserted.meta.changes ?? 0) !== 1) return "already_completed";
  await env.DB.prepare(
    `INSERT INTO point_transactions (id, guild_id, discord_user_id, amount, source, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      quest.guildId,
      discordUserId,
      quest.reward,
      `quest:${quest.id}`,
      JSON.stringify({ kind: "quest", questId: quest.id, title: quest.title })
    )
    .run();
  return "completed";
}

async function questConditionMet(env: Env, quest: Quest, discordUserId: string): Promise<boolean> {
  if (quest.kind === "link_wallet") {
    const row = await env.DB.prepare(
      "SELECT address FROM wallets WHERE discord_user_id = ? LIMIT 1"
    )
      .bind(discordUserId)
      .first<{ address: string }>();
    return row !== null;
  }
  if (quest.kind === "hold_role") {
    const roles = await getDiscordMemberRoles(env, quest.guildId, discordUserId);
    return roles.has(quest.config.roleId!);
  }
  if (quest.kind === "daily_claims") {
    const row = await env.DB.prepare(
      `SELECT COUNT(DISTINCT source) AS days
       FROM point_transactions
       WHERE guild_id = ? AND discord_user_id = ? AND source LIKE 'daily_claim:%'`
    )
      .bind(quest.guildId, discordUserId)
      .first<{ days: number | string | null }>();
    const days = Number(row?.days ?? 0);
    return Number.isSafeInteger(days) && days >= quest.config.days!;
  }
  return false;
}

export async function checkQuest(
  env: Env,
  guildId: string,
  questId: string,
  discordUserId: string
): Promise<{ result: QuestCheckResult; quest: Quest; balance: number }> {
  const quest = (await listQuests(env, guildId)).find((candidate) => candidate.id === questId);
  if (!quest) throw new QuestError("That quest is no longer available.");
  if (quest.kind === "code") {
    return { result: "not_met", quest, balance: await getPointsBalance(env, guildId, discordUserId) };
  }
  if (!(await questConditionMet(env, quest, discordUserId))) {
    return { result: "not_met", quest, balance: await getPointsBalance(env, guildId, discordUserId) };
  }
  const result = await completeQuest(env, quest, discordUserId);
  return { result, quest, balance: await getPointsBalance(env, guildId, discordUserId) };
}

export async function submitQuestCode(
  env: Env,
  guildId: string,
  discordUserId: string,
  code: unknown
): Promise<{ result: "completed" | "already_completed" | "no_match"; quest?: Quest; balance: number }> {
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new QuestError("Enter the secret code.");
  }
  const hash = await hashQuestCode(code);
  const quest = (await listQuests(env, guildId)).find(
    (candidate) => candidate.kind === "code" && candidate.config.codeHash === hash
  );
  if (!quest) {
    return { result: "no_match", balance: await getPointsBalance(env, guildId, discordUserId) };
  }
  const result = await completeQuest(env, quest, discordUserId);
  return { result, quest, balance: await getPointsBalance(env, guildId, discordUserId) };
}
