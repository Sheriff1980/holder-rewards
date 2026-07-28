import { getPointsBalance } from "./points.js";
import { getDiscordMemberRoles } from "./rules.js";
import type { Env } from "./types.js";

export type QuestKind = "link_wallet" | "hold_role" | "daily_claims" | "code" | "custom";

export type QuestConfig = {
  roleId?: string;
  days?: number;
  codeHash?: string;
  instructions?: string;
};

export type Quest = {
  id: string;
  guildId: string;
  title: string;
  kind: QuestKind;
  config: QuestConfig;
  reward: number;
};

export type QuestWithStatus = Quest & { completed: boolean; pendingSubmission: boolean };

export type QuestCheckResult = "completed" | "already_completed" | "not_met";

export class QuestError extends Error {}

const QUEST_KINDS = new Set<QuestKind>(["link_wallet", "hold_role", "daily_claims", "code", "custom"]);

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
      codeHash: typeof parsed.codeHash === "string" ? parsed.codeHash : undefined,
      instructions: typeof parsed.instructions === "string" ? parsed.instructions : undefined
    };
  } catch {
    return null;
  }
  if (row.kind === "hold_role" && !config.roleId) return null;
  if (row.kind === "daily_claims" && !config.days) return null;
  if (row.kind === "code" && !config.codeHash) return null;
  if (row.kind === "custom" && !config.instructions) return null;
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
  const [quests, completions, submissions] = await Promise.all([
    listQuests(env, guildId),
    env.DB.prepare(
      "SELECT quest_id FROM quest_completions WHERE guild_id = ? AND discord_user_id = ?"
    )
      .bind(guildId, discordUserId)
      .all<{ quest_id: string }>(),
    env.DB.prepare(
      "SELECT quest_id FROM quest_submissions WHERE guild_id = ? AND discord_user_id = ? AND status = 'pending'"
    )
      .bind(guildId, discordUserId)
      .all<{ quest_id: string }>()
  ]);
  const completed = new Set(completions.results.map((row) => row.quest_id));
  const pending = new Set(submissions.results.map((row) => row.quest_id));
  return quests.map((quest) => ({
    ...quest,
    completed: completed.has(quest.id),
    pendingSubmission: pending.has(quest.id)
  }));
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
    instructions?: unknown;
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
  if (kind === "custom") {
    if (
      typeof input.instructions !== "string" ||
      input.instructions.trim().length < 2 ||
      input.instructions.trim().length > 300
    ) {
      throw new QuestError("Quest instructions must be between 2 and 300 characters.");
    }
    config.instructions = input.instructions.trim();
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

export type QuestSubmission = {
  id: string;
  questId: string;
  questTitle: string;
  reward: number;
  discordUserId: string;
  proof: string;
  createdAt: string;
};

export async function submitQuestProof(
  env: Env,
  guildId: string,
  questId: string,
  discordUserId: string,
  proof: unknown
): Promise<{ quest: Quest }> {
  if (typeof proof !== "string" || proof.trim().length < 2 || proof.trim().length > 400) {
    throw new QuestError("Proof must be between 2 and 400 characters.");
  }
  const quest = (await listQuests(env, guildId)).find((candidate) => candidate.id === questId);
  if (!quest || quest.kind !== "custom") {
    throw new QuestError("That quest is no longer available.");
  }
  const completed = await env.DB.prepare(
    "SELECT quest_id FROM quest_completions WHERE quest_id = ? AND discord_user_id = ?"
  )
    .bind(quest.id, discordUserId)
    .first<{ quest_id: string }>();
  if (completed) {
    throw new QuestError(`You already completed ${quest.title}.`);
  }
  await env.DB.prepare(
    `INSERT INTO quest_submissions (id, quest_id, guild_id, discord_user_id, proof)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(quest_id, discord_user_id) DO UPDATE SET
       proof = excluded.proof,
       status = 'pending',
       reviewed_by = NULL,
       reviewed_at = NULL,
       created_at = CURRENT_TIMESTAMP`
  )
    .bind(crypto.randomUUID(), quest.id, guildId, discordUserId, proof.trim())
    .run();
  return { quest };
}

export async function listPendingSubmissions(env: Env, guildId: string): Promise<QuestSubmission[]> {
  const rows = await env.DB.prepare(
    `SELECT quest_submissions.id, quest_submissions.quest_id, quest_submissions.discord_user_id,
       quest_submissions.proof, quest_submissions.created_at,
       quests.title AS quest_title, quests.reward AS reward
     FROM quest_submissions
     JOIN quests ON quests.id = quest_submissions.quest_id
     WHERE quest_submissions.guild_id = ? AND quest_submissions.status = 'pending'
     ORDER BY quest_submissions.created_at`
  )
    .bind(guildId)
    .all<{
      id: string;
      quest_id: string;
      discord_user_id: string;
      proof: string;
      created_at: string;
      quest_title: string;
      reward: number;
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    questId: row.quest_id,
    questTitle: row.quest_title,
    reward: row.reward,
    discordUserId: row.discord_user_id,
    proof: row.proof,
    createdAt: row.created_at
  }));
}

export async function reviewQuestSubmission(
  env: Env,
  input: { guildId: string; submissionId: string; reviewerId: string; approve: boolean }
): Promise<{ submission: QuestSubmission; result: "approved" | "rejected" }> {
  const pending = await listPendingSubmissions(env, input.guildId);
  const submission = pending.find((candidate) => candidate.id === input.submissionId);
  if (!submission) {
    throw new QuestError("That submission was already reviewed or no longer exists.");
  }
  if (input.approve) {
    const quest = (await listQuests(env, input.guildId)).find(
      (candidate) => candidate.id === submission.questId
    );
    if (quest) await completeQuest(env, quest, submission.discordUserId);
  }
  await env.DB.prepare(
    `UPDATE quest_submissions
     SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'pending'`
  )
    .bind(input.approve ? "approved" : "rejected", input.reviewerId, submission.id)
    .run();
  return { submission, result: input.approve ? "approved" : "rejected" };
}
