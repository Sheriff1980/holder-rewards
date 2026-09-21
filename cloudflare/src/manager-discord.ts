import { createAdminSession } from "./admin.js";
import { recordAuditEvent, type AuditAction } from "./audit.js";
import {
  announceQuest,
  announceRaffle,
  announceStoreItem,
  configureQuestChannel,
  configureRewardsChannel,
  getQuestChannelSettings,
  getRewardsChannelSettings
} from "./announcements.js";
import {
  createQuest,
  listPendingSubmissions,
  listQuests,
  QuestError,
  removeQuest,
  reviewQuestSubmission
} from "./quests.js";
import { getRewardSettings, RewardSettingsError, updateRewardSettings } from "./points.js";
import { cancelRaffle, createRaffle, drawRaffle, listRaffles, RaffleError } from "./raffles.js";
import { createStoreItem, listStoreItems, removeStoreItem, StoreError } from "./store.js";
import type { DiscordInteraction, Env } from "./types.js";

const EPHEMERAL = 1 << 6;

type Button = {
  type: 2;
  style: number;
  label: string;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
};

function privateMessage(content: string, rows: Button[][] = []): Response {
  return Response.json({
    type: 4,
    data: {
      content: content.slice(0, 1_900),
      flags: EPHEMERAL,
      allowed_mentions: { parse: [] },
      components: rows.filter((row) => row.length > 0).map((components) => ({ type: 1, components }))
    }
  });
}

function privateRoleSelectMessage(content: string, customId: string): Response {
  return Response.json({
    type: 4,
    data: {
      content,
      flags: EPHEMERAL,
      allowed_mentions: { parse: [] },
      components: [{
        type: 1,
        components: [{ type: 6, custom_id: customId, placeholder: "Choose the required Discord role", min_values: 1, max_values: 1 }]
      }]
    }
  });
}

function textInput(
  customId: string,
  label: string,
  options: { value?: string; placeholder?: string; required?: boolean; maxLength?: number; paragraph?: boolean } = {}
): Record<string, unknown> {
  return {
    type: 1,
    components: [{
      type: 4,
      custom_id: customId,
      label,
      style: options.paragraph ? 2 : 1,
      required: options.required ?? true,
      ...(options.value !== undefined ? { value: options.value } : {}),
      ...(options.placeholder ? { placeholder: options.placeholder } : {}),
      ...(options.maxLength ? { max_length: options.maxLength } : {})
    }]
  };
}

function modal(customId: string, title: string, components: Record<string, unknown>[]): Response {
  return Response.json({ type: 9, data: { custom_id: customId, title: title.slice(0, 45), components } });
}

function modalValues(interaction: DiscordInteraction): Record<string, string> {
  const values: Record<string, string> = {};
  for (const row of interaction.data?.components ?? []) {
    for (const component of row.components ?? []) {
      if (component.custom_id && typeof component.value === "string") values[component.custom_id] = component.value;
    }
  }
  return values;
}

function backButton(): Button {
  return { type: 2, style: 2, label: "Manager dashboard", custom_id: "manager:home" };
}

async function record(env: Env, guildId: string, userId: string, action: AuditAction, detail: string): Promise<void> {
  await recordAuditEvent(env, { guildId, actorDiscordUserId: userId, action, detail });
}

export async function managerDashboardResponse(
  env: Env,
  guildId: string,
  discordUserId: string,
  requestUrl: URL
): Promise<Response> {
  const token = await createAdminSession(env, discordUserId, guildId);
  const advancedUrl = new URL("/manage", requestUrl.origin);
  advancedUrl.searchParams.set("token", token);
  return privateMessage(
    "**Manager dashboard**\nManage routine community rewards here in Discord. Only managers can use these controls.",
    [
      [
        { type: 2, style: 1, label: "Reward settings", custom_id: "manager:rewards" },
        { type: 2, style: 1, label: "Quests", custom_id: "manager:quests" },
        { type: 2, style: 1, label: "Store", custom_id: "manager:store" },
        { type: 2, style: 1, label: "Raffles", custom_id: "manager:raffles" }
      ],
      [
        { type: 2, style: 2, label: "Review quest proofs", custom_id: "manager:proofs" },
        { type: 2, style: 2, label: "Republish panels", custom_id: "manager:publish" },
        { type: 2, style: 5, label: "Advanced manager", url: advancedUrl.toString() }
      ]
    ]
  );
}

async function questsResponse(env: Env, guildId: string): Promise<Response> {
  const [quests, settings] = await Promise.all([listQuests(env, guildId), getRewardSettings(env, guildId)]);
  const visible = quests.slice(0, 4);
  const lines = visible.length > 0
    ? visible.map((quest) => `**${quest.title}** - ${quest.reward.toLocaleString()} ${settings.currencyName} - ${quest.kind.replaceAll("_", " ")}`).join("\n")
    : "No quests are active.";
  return privateMessage(`**Manage quests**\n${lines}${quests.length > 4 ? `\n\n${quests.length - 4} more available in Advanced manager.` : ""}`, [
    [
      { type: 2, style: 1, label: "New quest", custom_id: "manager:quest:new" },
      ...visible.map((quest): Button => ({
        type: 2,
        style: 4,
        label: `Remove: ${quest.title}`.slice(0, 80),
        custom_id: `manager:quest:remove:${quest.id}`
      }))
    ],
    [backButton()]
  ]);
}

async function storeResponse(env: Env, guildId: string): Promise<Response> {
  const [items, settings] = await Promise.all([listStoreItems(env, guildId), getRewardSettings(env, guildId)]);
  const visible = items.slice(0, 4);
  const lines = visible.length > 0
    ? visible.map((item) => `**${item.title}** - ${item.price.toLocaleString()} ${settings.currencyName} - ${item.stock === null ? "unlimited" : `${item.stock} left`}`).join("\n")
    : "No store items are active.";
  return privateMessage(`**Manage store**\n${lines}${items.length > 4 ? `\n\n${items.length - 4} more available in Advanced manager.` : ""}`, [
    [
      { type: 2, style: 1, label: "New store item", custom_id: "manager:store:new" },
      ...visible.map((item): Button => ({
        type: 2,
        style: 4,
        label: `Remove: ${item.title}`.slice(0, 80),
        custom_id: `manager:store:remove:${item.id}`
      }))
    ],
    [backButton()]
  ]);
}

async function rafflesResponse(env: Env, guildId: string): Promise<Response> {
  const [raffles, settings] = await Promise.all([listRaffles(env, guildId), getRewardSettings(env, guildId)]);
  const open = raffles.filter((raffle) => raffle.status === "open");
  const visible = open.slice(0, 2);
  const lines = visible.length > 0
    ? visible.map((raffle) => `**${raffle.title}** - ${raffle.totalEntries.toLocaleString()} entries - ${raffle.entryCost.toLocaleString()} ${settings.currencyName} each`).join("\n")
    : "No raffles are open.";
  return privateMessage(`**Manage raffles**\n${lines}${open.length > 2 ? `\n\n${open.length - 2} more available in Advanced manager.` : ""}`, [
    [
      { type: 2, style: 1, label: "New raffle", custom_id: "manager:raffle:new" },
      ...visible.flatMap((raffle): Button[] => [
        { type: 2, style: 3, label: `Draw: ${raffle.title}`.slice(0, 80), custom_id: `manager:raffle:draw:${raffle.id}` },
        { type: 2, style: 4, label: `Cancel: ${raffle.title}`.slice(0, 80), custom_id: `manager:raffle:cancel:${raffle.id}` }
      ])
    ],
    [backButton()]
  ]);
}

async function proofsResponse(env: Env, guildId: string): Promise<Response> {
  const submissions = await listPendingSubmissions(env, guildId);
  const visible = submissions.slice(0, 2);
  const lines = visible.length > 0
    ? visible.map((submission) => `**${submission.questTitle}** from <@${submission.discordUserId}>\n${submission.proof}`).join("\n\n")
    : "No quest proofs are waiting for review.";
  return privateMessage(`**Quest proof review**\n${lines}${submissions.length > 2 ? `\n\n${submissions.length - 2} more available in Advanced manager.` : ""}`, [
    visible.flatMap((submission): Button[] => [
      { type: 2, style: 3, label: `Approve: ${submission.questTitle}`.slice(0, 80), custom_id: `manager:proof:approve:${submission.id}` },
      { type: 2, style: 4, label: `Reject: ${submission.questTitle}`.slice(0, 80), custom_id: `manager:proof:reject:${submission.id}` }
    ]),
    [backButton()]
  ]);
}

async function announceCreatedQuest(env: Env, guildId: string, origin: string, quest: Awaited<ReturnType<typeof createQuest>>): Promise<string> {
  try {
    return await announceQuest(env, guildId, origin, quest) ? " The public quest announcement was posted." : " No quest channel is configured yet.";
  } catch {
    return " The quest was saved, but Discord could not post its announcement.";
  }
}

export async function handleManagerInteraction(
  interaction: DiscordInteraction,
  requestUrl: URL,
  env: Env,
  guildId: string,
  discordUserId: string
): Promise<Response | null> {
  const id = interaction.data?.custom_id;
  if (!id?.startsWith("manager:")) return null;

  try {
    if (interaction.type === 3 && id === "manager:home") {
      return managerDashboardResponse(env, guildId, discordUserId, requestUrl);
    }
    if (interaction.type === 3 && id === "manager:rewards") {
      const settings = await getRewardSettings(env, guildId);
      return modal("manager:rewards:save", "Community reward settings", [
        textInput("currency", "Currency name", { value: settings.currencyName, maxLength: 32 }),
        textInput("daily", "Daily claim amount", { value: String(settings.dailyClaimAmount), maxLength: 7 }),
        textInput("holder", "Extra daily holder reward", { value: String(settings.holderDailyAmount), maxLength: 7 }),
        textInput("tips", "Daily tipping limit per member", { value: String(settings.tipDailyLimit), maxLength: 7 })
      ]);
    }
    if (interaction.type === 5 && id === "manager:rewards:save") {
      const input = modalValues(interaction);
      const settings = await updateRewardSettings(env, guildId, {
        currencyName: input.currency,
        dailyClaimAmount: input.daily,
        holderDailyAmount: input.holder,
        tipDailyLimit: input.tips
      });
      await record(env, guildId, discordUserId, "reward_settings_updated", `Currency ${settings.currencyName}; daily ${settings.dailyClaimAmount}; holder ${settings.holderDailyAmount}`);
      return privateMessage(`Reward settings saved. Daily claim: ${settings.dailyClaimAmount.toLocaleString()} ${settings.currencyName}. Extra holder reward: ${settings.holderDailyAmount.toLocaleString()}.`, [[backButton()]]);
    }
    if (interaction.type === 3 && id === "manager:quests") return questsResponse(env, guildId);
    if (interaction.type === 3 && id === "manager:quest:new") {
      return privateMessage("**Choose a quest type**", [[
        { type: 2, style: 1, label: "Custom proof", custom_id: "manager:quest:form:custom" },
        { type: 2, style: 1, label: "Secret code", custom_id: "manager:quest:form:code" },
        { type: 2, style: 1, label: "Link wallet", custom_id: "manager:quest:form:link_wallet" },
        { type: 2, style: 1, label: "Daily claims", custom_id: "manager:quest:form:daily_claims" },
        { type: 2, style: 1, label: "Hold a role", custom_id: "manager:quest:holder" }
      ], [backButton()]]);
    }
    if (interaction.type === 3 && id === "manager:quest:holder") {
      return privateRoleSelectMessage("Choose the Discord role members must hold for this quest.", "manager:quest:holder-role");
    }
    if (interaction.type === 3 && id === "manager:quest:holder-role") {
      const roleId = interaction.data?.values?.[0];
      if (!roleId || !/^\d{15,22}$/.test(roleId)) return privateMessage("Choose a Discord role.", [[backButton()]]);
      return modal(`manager:quest:create:hold_role:${roleId}`, "Create holder-role quest", [
        textInput("title", "Quest title", { maxLength: 80 }),
        textInput("reward", "Reward amount", { maxLength: 7 })
      ]);
    }
    if (interaction.type === 3 && id.startsWith("manager:quest:form:")) {
      const kind = id.slice("manager:quest:form:".length);
      const extra = kind === "custom"
        ? textInput("instructions", "Instructions", { paragraph: true, maxLength: 300 })
        : kind === "code"
          ? textInput("code", "Secret code", { maxLength: 100 })
          : kind === "daily_claims"
            ? textInput("days", "Number of claim days", { placeholder: "7", maxLength: 3 })
            : null;
      return modal(`manager:quest:create:${kind}`, "Create quest", [
        textInput("title", "Quest title", { maxLength: 80 }),
        textInput("reward", "Reward amount", { maxLength: 7 }),
        ...(extra ? [extra] : [])
      ]);
    }
    if (interaction.type === 5 && id.startsWith("manager:quest:create:")) {
      const kindAndRole = id.slice("manager:quest:create:".length);
      const [kind, roleId] = kindAndRole.split(":");
      const input = modalValues(interaction);
      const quest = await createQuest(env, {
        guildId,
        title: input.title,
        reward: input.reward,
        kind,
        roleId,
        code: input.code,
        days: input.days,
        instructions: input.instructions
      });
      const settings = await getRewardSettings(env, guildId);
      await record(env, guildId, discordUserId, "quest_created", `Quest "${quest.title}" (${quest.kind})`);
      const announcement = await announceCreatedQuest(env, guildId, requestUrl.origin, quest);
      return privateMessage(`Quest **${quest.title}** created for ${quest.reward.toLocaleString()} ${settings.currencyName}.${announcement}`, [[{ type: 2, style: 2, label: "Back to quests", custom_id: "manager:quests" }]]);
    }
    if (interaction.type === 3 && id.startsWith("manager:quest:remove:")) {
      const questId = id.slice("manager:quest:remove:".length);
      const removed = await removeQuest(env, guildId, questId);
      if (removed) await record(env, guildId, discordUserId, "quest_removed", `Quest ...${questId.slice(-6)} removed`);
      return privateMessage(removed ? "Quest removed." : "That quest was already removed.", [[{ type: 2, style: 2, label: "Back to quests", custom_id: "manager:quests" }]]);
    }
    if (interaction.type === 3 && id === "manager:store") return storeResponse(env, guildId);
    if (interaction.type === 3 && id === "manager:store:new") {
      return modal("manager:store:create", "Create store item", [
        textInput("title", "Item name", { maxLength: 80 }),
        textInput("description", "Description", { required: false, paragraph: true, maxLength: 200 }),
        textInput("price", "Price", { maxLength: 7 }),
        textInput("stock", "Total stock (blank for unlimited)", { required: false, maxLength: 5 }),
        textInput("limit", "Maximum per member (blank for none)", { required: false, maxLength: 5 })
      ]);
    }
    if (interaction.type === 5 && id === "manager:store:create") {
      const input = modalValues(interaction);
      const item = await createStoreItem(env, {
        guildId,
        title: input.title,
        description: input.description,
        price: input.price,
        stock: input.stock,
        purchaseLimitPerMember: input.limit
      });
      await record(env, guildId, discordUserId, "store_item_created", `Store item "${item.title}" (${item.price} points)`);
      let announcement = " No store channel is configured yet.";
      try {
        if (await announceStoreItem(env, guildId, requestUrl.origin, item)) announcement = " The public store announcement was posted.";
      } catch {
        announcement = " The item was saved, but Discord could not post its announcement.";
      }
      return privateMessage(`Store item **${item.title}** created.${announcement}`, [[{ type: 2, style: 2, label: "Back to store", custom_id: "manager:store" }]]);
    }
    if (interaction.type === 3 && id.startsWith("manager:store:remove:")) {
      const itemId = id.slice("manager:store:remove:".length);
      const removed = await removeStoreItem(env, guildId, itemId);
      if (removed) await record(env, guildId, discordUserId, "store_item_removed", `Store item ...${itemId.slice(-6)} removed`);
      return privateMessage(removed ? "Store item removed." : "That item was already removed.", [[{ type: 2, style: 2, label: "Back to store", custom_id: "manager:store" }]]);
    }
    if (interaction.type === 3 && id === "manager:raffles") return rafflesResponse(env, guildId);
    if (interaction.type === 3 && id === "manager:raffle:new") {
      return modal("manager:raffle:create", "Create raffle", [
        textInput("title", "Raffle name", { maxLength: 80 }),
        textInput("prize", "Prize", { paragraph: true, maxLength: 120 }),
        textInput("cost", "Cost per entry", { maxLength: 7 }),
        textInput("limit", "Maximum entries per member", { value: "10", maxLength: 4 })
      ]);
    }
    if (interaction.type === 5 && id === "manager:raffle:create") {
      const input = modalValues(interaction);
      const raffle = await createRaffle(env, {
        guildId,
        title: input.title,
        prize: input.prize,
        entryCost: input.cost,
        maxEntriesPerMember: input.limit,
        createdBy: discordUserId
      });
      await record(env, guildId, discordUserId, "raffle_created", `Raffle "${raffle.title}" (${raffle.entryCost} points)`);
      let announcement = " No raffle channel is configured yet.";
      try {
        if (await announceRaffle(env, guildId, requestUrl.origin, raffle)) announcement = " The public raffle announcement was posted.";
      } catch {
        announcement = " The raffle was saved, but Discord could not post its announcement.";
      }
      return privateMessage(`Raffle **${raffle.title}** created.${announcement}`, [[{ type: 2, style: 2, label: "Back to raffles", custom_id: "manager:raffles" }]]);
    }
    if (interaction.type === 3 && id.startsWith("manager:raffle:draw:")) {
      const raffleId = id.slice("manager:raffle:draw:".length);
      const result = await drawRaffle(env, { guildId, raffleId });
      await record(env, guildId, discordUserId, "raffle_drawn", `Raffle "${result.raffle.title}" drawn`);
      return privateMessage(`Winner for **${result.raffle.title}**: <@${result.winnerDiscordUserId}>.${result.roleGranted ? " The prize role was added." : ""}`, [[{ type: 2, style: 2, label: "Back to raffles", custom_id: "manager:raffles" }]]);
    }
    if (interaction.type === 3 && id.startsWith("manager:raffle:cancel:")) {
      const raffleId = id.slice("manager:raffle:cancel:".length);
      const result = await cancelRaffle(env, { guildId, raffleId });
      const settings = await getRewardSettings(env, guildId);
      await record(env, guildId, discordUserId, "raffle_cancelled", `Raffle "${result.raffle.title}" cancelled`);
      return privateMessage(`Raffle **${result.raffle.title}** cancelled. ${result.refundedPoints.toLocaleString()} ${settings.currencyName} were refunded to ${result.refundedMembers.toLocaleString()} members.`, [[{ type: 2, style: 2, label: "Back to raffles", custom_id: "manager:raffles" }]]);
    }
    if (interaction.type === 3 && id === "manager:proofs") return proofsResponse(env, guildId);
    if (interaction.type === 3 && (id.startsWith("manager:proof:approve:") || id.startsWith("manager:proof:reject:"))) {
      const approve = id.startsWith("manager:proof:approve:");
      const submissionId = id.slice((approve ? "manager:proof:approve:" : "manager:proof:reject:").length);
      const result = await reviewQuestSubmission(env, { guildId, submissionId, reviewerId: discordUserId, approve });
      await record(env, guildId, discordUserId, approve ? "quest_submission_approved" : "quest_submission_rejected", `"${result.submission.questTitle}" ${result.result}`);
      return privateMessage(`Quest proof ${result.result}.`, [[{ type: 2, style: 2, label: "Review more proofs", custom_id: "manager:proofs" }]]);
    }
    if (interaction.type === 3 && id === "manager:publish") {
      const [questSettings, rewardSettings] = await Promise.all([
        getQuestChannelSettings(env, guildId),
        getRewardsChannelSettings(env, guildId)
      ]);
      const published: string[] = [];
      if (questSettings.channelId) {
        await configureQuestChannel(env, guildId, questSettings.channelId, requestUrl.origin);
        published.push("quest panel");
      }
      if (rewardSettings.channelId) {
        await configureRewardsChannel(env, guildId, rewardSettings.channelId, requestUrl.origin);
        published.push("store and raffle panels");
      }
      return privateMessage(
        published.length > 0
          ? `Republished the ${published.join(" and ")}.`
          : "No public quest, store, or raffle channels are configured yet. Choose them once in Advanced manager.",
        [[backButton()]]
      );
    }
  } catch (error) {
    if (error instanceof RewardSettingsError || error instanceof QuestError || error instanceof StoreError || error instanceof RaffleError) {
      return privateMessage(error.message, [[backButton()]]);
    }
    return privateMessage("That manager action could not be fully completed. Refresh the relevant list before trying again.", [[backButton()]]);
  }

  return privateMessage("That manager option is not available.", [[backButton()]]);
}
