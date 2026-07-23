import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  parseAbi,
  parseUnits,
  type Address
} from "viem";
import { listChains } from "./chains.js";
import type { Env } from "./types.js";
import { loadTokenAttributes, metadataHasTrait } from "./metadata.js";
import { isSolanaAddress, solanaTokenQualifies } from "./solana.js";
import { accrueDailyHolderPoints } from "./points.js";

const MAX_TRAIT_NFT_SCAN = 15;
const TRAIT_SCAN_BATCH = 5;
const OWNERSHIP_CACHE_TTL_MS = 60_000;
const DISCORD_MAX_ATTEMPTS = 3;
const DISCORD_MAX_RETRY_DELAY_MS = 1_000;
const erc721TraitAbi = parseAbi([
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)"
]);
const erc721OwnerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)"
]);
const erc1155BalanceAbi = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)"
]);
const MAX_UINT256 = (1n << 256n) - 1n;

export type EvmRoleRule =
  | { type: "erc721"; contractAddress: Address; minCount: number }
  | { type: "erc20"; contractAddress: Address; minAmount: string }
  | { type: "erc721-token"; contractAddress: Address; tokenId: string }
  | {
      type: "erc1155";
      contractAddress: Address;
      tokenId: string;
      minAmount: string;
    }
  | {
      type: "erc721-trait";
      contractAddress: Address;
      traitName: string;
      traitValue: string;
      minCount: number;
    };

export type SolanaRoleRule = {
  type: "spl-token";
  mintAddress: string;
  minAmount: string;
};

export type RoleRuleDefinition = EvmRoleRule | SolanaRoleRule;
export type RuleMatchMode = "any" | "all";

export type RoleRuleRecord = {
  id: string;
  guildId: string;
  roleId: string;
  chainId: string;
  matchMode: RuleMatchMode;
  rewardMultiplier: number;
  definition: RoleRuleDefinition;
};

type RoleRuleRow = {
  id: string;
  guild_id: string;
  role_id: string;
  chain: string;
  match_mode: string;
  reward_multiplier?: number;
  rule: string;
};

type WalletRow = { chain: string; address: string };

type RuleOutcome = {
  rule: RoleRuleRecord;
  qualifies?: boolean;
  balance?: string;
  error?: string;
};

type OwnershipCacheRow = {
  qualifies: number;
  balance: string;
};

export function isUint256(value: unknown, positive = false): value is string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value) || value.length > 78) {
    return false;
  }
  const parsed = BigInt(value);
  return parsed <= MAX_UINT256 && (!positive || parsed > 0n);
}

export class RuleError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function buildOwnershipCacheKey(
  rule: Pick<RoleRuleRecord, "chainId" | "definition">,
  chainReference: string,
  rpcUrl: string,
  walletAddresses: string[]
): Promise<string> {
  const payload = JSON.stringify({
    chainId: rule.chainId,
    chainReference,
    rpcUrl,
    definition: rule.definition,
    wallets: [...walletAddresses].sort((left, right) => left.localeCompare(right))
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readOwnershipCache(
  env: Env,
  cacheKey: string,
  rule: RoleRuleRecord
): Promise<RuleOutcome | null> {
  try {
    const cached = await env.DB.prepare(
      `SELECT qualifies, balance
       FROM ownership_cache
       WHERE cache_key = ? AND expires_at > ?`
    )
      .bind(cacheKey, new Date().toISOString())
      .first<OwnershipCacheRow>();
    return cached
      ? { rule, qualifies: cached.qualifies === 1, balance: cached.balance }
      : null;
  } catch {
    return null;
  }
}

async function writeOwnershipCache(
  env: Env,
  cacheKey: string,
  outcome: RuleOutcome
): Promise<void> {
  if (typeof outcome.qualifies !== "boolean" || outcome.error) return;
  const expiresAt = new Date(Date.now() + OWNERSHIP_CACHE_TTL_MS).toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO ownership_cache (cache_key, qualifies, balance, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         qualifies = excluded.qualifies,
         balance = excluded.balance,
         expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP`
    )
      .bind(cacheKey, outcome.qualifies ? 1 : 0, outcome.balance ?? "0", expiresAt)
      .run();
  } catch {
    // Ownership checks remain authoritative when the optional cache is unavailable.
  }
}

function parseStoredRule(row: RoleRuleRow): RoleRuleRecord | null {
  try {
    const definition = JSON.parse(row.rule) as Partial<RoleRuleDefinition>;
    if (definition.type === "spl-token") {
      if (
        typeof definition.mintAddress !== "string" ||
        !isSolanaAddress(definition.mintAddress) ||
        typeof definition.minAmount !== "string" ||
        !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(definition.minAmount) ||
        !/[1-9]/.test(definition.minAmount)
      ) {
        return null;
      }
      return {
        id: row.id,
        guildId: row.guild_id,
        roleId: row.role_id,
        chainId: row.chain,
        matchMode: row.match_mode === "all" ? "all" : "any",
        rewardMultiplier: Number.isSafeInteger(row.reward_multiplier) ? Number(row.reward_multiplier) : 1,
        definition: definition as SolanaRoleRule
      };
    }
    if (
      (definition.type !== "erc721" &&
        definition.type !== "erc20" &&
        definition.type !== "erc721-trait" &&
        definition.type !== "erc721-token" &&
        definition.type !== "erc1155") ||
      typeof definition.contractAddress !== "string" ||
      !isAddress(definition.contractAddress)
    ) {
      return null;
    }
    if (
      (definition.type === "erc721" || definition.type === "erc721-trait") &&
      (!Number.isSafeInteger(definition.minCount) || Number(definition.minCount) < 1)
    ) {
      return null;
    }
    if (
      definition.type === "erc721-trait" &&
      (typeof definition.traitName !== "string" ||
        definition.traitName.length === 0 ||
        definition.traitName.length > 100 ||
        typeof definition.traitValue !== "string" ||
        definition.traitValue.length === 0 ||
        definition.traitValue.length > 200)
    ) {
      return null;
    }
    if (
      definition.type === "erc20" &&
      (typeof definition.minAmount !== "string" ||
        definition.minAmount.length > 80 ||
        !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(definition.minAmount))
    ) {
      return null;
    }
    if (
      (definition.type === "erc721-token" || definition.type === "erc1155") &&
      !isUint256(definition.tokenId)
    ) {
      return null;
    }
    if (definition.type === "erc1155" && !isUint256(definition.minAmount, true)) {
      return null;
    }
    return {
      id: row.id,
      guildId: row.guild_id,
      roleId: row.role_id,
      chainId: row.chain,
      matchMode: row.match_mode === "all" ? "all" : "any",
      rewardMultiplier: Number.isSafeInteger(row.reward_multiplier) ? Number(row.reward_multiplier) : 1,
      definition: definition as EvmRoleRule
    };
  } catch {
    return null;
  }
}

function requireSnowflake(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9]{15,22}$/.test(value)) {
    throw new RuleError(`${label} must be a valid Discord ID.`);
  }
  return value;
}

function requireContract(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new RuleError("Contract must be a valid EVM address.");
  }
  return getAddress(value);
}

export async function addRoleRule(
  env: Env,
  input: {
    guildId: unknown;
    roleId: unknown;
    chainId: unknown;
    type: "erc721" | "erc20" | "erc721-trait" | "erc721-token" | "erc1155" | "spl-token";
    contractAddress: unknown;
    minimum: unknown;
    traitName?: unknown;
    traitValue?: unknown;
    tokenId?: unknown;
    matchMode?: unknown;
    rewardMultiplier?: unknown;
  }
): Promise<RoleRuleRecord> {
  const guildId = requireSnowflake(input.guildId, "Server");
  const roleId = requireSnowflake(input.roleId, "Role");
  if (roleId === guildId) throw new RuleError("The @everyone role cannot be managed by a holder rule.");
  if (typeof input.chainId !== "string") throw new RuleError("Chain is required.");
  const chain = (await listChains(env)).find((candidate) => candidate.id === input.chainId);
  const expectedFamily = input.type === "spl-token" ? "solana" : "evm";
  if (!chain || chain.family !== expectedFamily) {
    throw new RuleError(`Choose an enabled ${expectedFamily === "solana" ? "Solana" : "EVM"} chain.`);
  }
  if (!chain.defaultRpcUrl) {
    throw new RuleError("That chain needs a public RPC URL before ownership rules can use it.");
  }
  const existingRoleSettings = await env.DB.prepare(
    "SELECT match_mode, reward_multiplier FROM role_rules WHERE guild_id = ? AND role_id = ? AND enabled = 1 LIMIT 1"
  )
    .bind(guildId, roleId)
    .first<{ match_mode: string; reward_multiplier: number }>();
  const matchMode = input.matchMode === undefined || input.matchMode === null || input.matchMode === ""
    ? existingRoleSettings?.match_mode === "all" ? "all" : "any"
    : input.matchMode;
  if (matchMode !== "any" && matchMode !== "all") {
    throw new RuleError("Choose whether any or all requirements are needed for this role.");
  }
  const rewardMultiplier = input.rewardMultiplier === undefined || input.rewardMultiplier === null || input.rewardMultiplier === ""
    ? existingRoleSettings?.reward_multiplier ?? 1
    : Number(input.rewardMultiplier);
  if (!Number.isSafeInteger(rewardMultiplier) || rewardMultiplier < 1 || rewardMultiplier > 100) {
    throw new RuleError("Reward multiplier must be a whole number between 1 and 100.");
  }

  let definition: RoleRuleDefinition;
  if (input.type === "spl-token") {
    if (!isSolanaAddress(input.contractAddress)) {
      throw new RuleError("Mint must be a valid Solana address.");
    }
    const minAmount = String(input.minimum ?? "");
    if (
      !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(minAmount) ||
      !/[1-9]/.test(minAmount)
    ) {
      throw new RuleError("Solana token minimum must be a positive decimal amount.");
    }
    definition = { type: "spl-token", mintAddress: input.contractAddress, minAmount };
  } else {
    const contractAddress = requireContract(input.contractAddress);
    if (input.type === "erc721" || input.type === "erc721-trait") {
    const minCount = Number(input.minimum);
    if (!Number.isSafeInteger(minCount) || minCount < 1 || minCount > 1_000_000) {
      throw new RuleError("NFT minimum must be a whole number between 1 and 1,000,000.");
    }
    if (input.type === "erc721-trait") {
      if (
        typeof input.traitName !== "string" ||
        input.traitName.trim().length === 0 ||
        input.traitName.length > 100 ||
        typeof input.traitValue !== "string" ||
        input.traitValue.trim().length === 0 ||
        input.traitValue.length > 200
      ) {
        throw new RuleError("Trait name and value are required and must fit within their limits.");
      }
      definition = {
        type: "erc721-trait",
        contractAddress,
        traitName: input.traitName.trim(),
        traitValue: input.traitValue.trim(),
        minCount
      };
    } else {
      definition = { type: "erc721", contractAddress, minCount };
    }
    } else if (input.type === "erc20") {
    const minAmount = String(input.minimum ?? "");
    if (
      minAmount.length > 80 ||
      !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,36})?$/.test(minAmount) ||
      !/[1-9]/.test(minAmount)
    ) {
      throw new RuleError("Token minimum must be a positive decimal amount.");
    }
    definition = { type: "erc20", contractAddress, minAmount };
    } else {
    const tokenIdInput = String(input.tokenId ?? "");
    if (!isUint256(tokenIdInput)) {
      throw new RuleError("Token ID must be an integer between 0 and the uint256 maximum.");
    }
    const tokenId = BigInt(tokenIdInput).toString();
    if (input.type === "erc721-token") {
      definition = { type: "erc721-token", contractAddress, tokenId };
    } else {
      const minAmountInput = String(input.minimum ?? "");
      if (!isUint256(minAmountInput, true)) {
        throw new RuleError("ERC-1155 minimum must be a positive whole number.");
      }
      definition = {
        type: "erc1155",
        contractAddress,
        tokenId,
        minAmount: BigInt(minAmountInput).toString()
      };
    }
    }
  }

  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(guildId),
    env.DB.prepare(
      "UPDATE role_rules SET match_mode = ?, reward_multiplier = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND role_id = ? AND enabled = 1"
    ).bind(matchMode, rewardMultiplier, guildId, roleId),
    env.DB.prepare(
      `INSERT INTO role_rules
        (id, guild_id, role_id, chain, match_mode, reward_multiplier, rule)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, guildId, roleId, chain.id, matchMode, rewardMultiplier, JSON.stringify(definition))
  ]);

  return { id, guildId, roleId, chainId: chain.id, matchMode, rewardMultiplier, definition };
}

export async function listRoleRules(env: Env, guildId: string): Promise<RoleRuleRecord[]> {
  const rows = await env.DB.prepare(
    `SELECT id, guild_id, role_id, chain, match_mode, reward_multiplier, rule
     FROM role_rules WHERE guild_id = ? AND enabled = 1 ORDER BY created_at`
  )
    .bind(guildId)
    .all<RoleRuleRow>();
  return rows.results.map(parseStoredRule).filter((rule): rule is RoleRuleRecord => rule !== null);
}

async function listRetiredRoleIds(env: Env, guildId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT retired.role_id
     FROM role_rules retired
     WHERE retired.guild_id = ?
       AND retired.enabled = 0
       AND NOT EXISTS (
         SELECT 1
         FROM role_rules active
         WHERE active.guild_id = retired.guild_id
           AND active.role_id = retired.role_id
           AND active.enabled = 1
       )`
  )
    .bind(guildId)
    .all<{ role_id: string }>();
  return rows.results.map((row) => row.role_id);
}

export async function updateRoleMatchMode(
  env: Env,
  guildIdInput: unknown,
  roleIdInput: unknown,
  matchModeInput: unknown
): Promise<RuleMatchMode> {
  const guildId = requireSnowflake(guildIdInput, "Server");
  const roleId = requireSnowflake(roleIdInput, "Role");
  if (matchModeInput !== "any" && matchModeInput !== "all") {
    throw new RuleError("Choose whether any or all requirements are needed for this role.");
  }
  const result = await env.DB.prepare(
    `UPDATE role_rules
     SET match_mode = ?, updated_at = CURRENT_TIMESTAMP
     WHERE guild_id = ? AND role_id = ? AND enabled = 1`
  )
    .bind(matchModeInput, guildId, roleId)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new RuleError("That role has no active holder requirements.", 404);
  }
  return matchModeInput;
}

export async function updateRoleRewardMultiplier(
  env: Env,
  guildIdInput: unknown,
  roleIdInput: unknown,
  multiplierInput: unknown
): Promise<number> {
  const guildId = requireSnowflake(guildIdInput, "Server");
  const roleId = requireSnowflake(roleIdInput, "Role");
  const multiplier = Number(multiplierInput);
  if (!Number.isSafeInteger(multiplier) || multiplier < 1 || multiplier > 100) {
    throw new RuleError("Reward multiplier must be a whole number between 1 and 100.");
  }
  const result = await env.DB.prepare(
    `UPDATE role_rules
     SET reward_multiplier = ?, updated_at = CURRENT_TIMESTAMP
     WHERE guild_id = ? AND role_id = ? AND enabled = 1`
  )
    .bind(multiplier, guildId, roleId)
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new RuleError("That role has no active holder requirements.", 404);
  }
  return multiplier;
}

export async function removeRoleRule(env: Env, guildId: string, ruleId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE role_rules SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ? AND enabled = 1"
  )
    .bind(ruleId, guildId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

async function evaluateRule(
  env: Env,
  rule: RoleRuleRecord,
  walletAddresses: Address[],
  rpcUrl: string,
  expectedChainId: number
): Promise<RuleOutcome> {
  if (rule.definition.type === "spl-token") {
    return { rule, error: "A Solana rule cannot be evaluated by an EVM provider." };
  }
  const definition = rule.definition as EvmRoleRule;
  if (walletAddresses.length === 0) return { rule, qualifies: false, balance: "0" };

  try {
    const client = createPublicClient({
      transport: http(rpcUrl, { batch: true, retryCount: 1, timeout: 5_000 })
    });
    const actualChainId = await client.getChainId();
    if (actualChainId !== expectedChainId) {
      throw new Error(`RPC returned chain ${actualChainId}; expected ${expectedChainId}.`);
    }

    if (rule.definition.type === "erc721-token") {
      let owner: Address;
      try {
        owner = await client.readContract({
          address: definition.contractAddress,
          abi: erc721OwnerAbi,
          functionName: "ownerOf",
          args: [BigInt(rule.definition.tokenId)]
        });
      } catch (error) {
        const reverted =
          error instanceof BaseError &&
          error.walk((cause) => cause instanceof ContractFunctionRevertedError);
        if (reverted) return { rule, qualifies: false, balance: "0" };
        throw error;
      }
      const qualifies = walletAddresses.some((wallet) => isAddressEqual(wallet, owner));
      return {
        rule,
        qualifies,
        balance: qualifies ? "1" : "0"
      };
    }

    if (rule.definition.type === "erc1155") {
      const erc1155Rule = rule.definition;
      const balances = await Promise.all(
        walletAddresses.map((address) =>
          client.readContract({
            address: erc1155Rule.contractAddress,
            abi: erc1155BalanceAbi,
            functionName: "balanceOf",
            args: [address, BigInt(erc1155Rule.tokenId)]
          })
        )
      );
      const total = balances.reduce((sum, value) => sum + value, 0n);
      return {
        rule,
        qualifies: total >= BigInt(erc1155Rule.minAmount),
        balance: total.toString()
      };
    }
    const balances = await Promise.all(
      walletAddresses.map((address) =>
        client.readContract({
          address: definition.contractAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address]
        })
      )
    );
    const total = balances.reduce((sum, value) => sum + value, 0n);

    if (rule.definition.type === "erc721-trait") {
      const traitRule = rule.definition;
      const ownershipSlots: Array<{ address: Address; index: bigint }> = [];
      for (let walletIndex = 0; walletIndex < walletAddresses.length; walletIndex += 1) {
        const balance = balances[walletIndex] ?? 0n;
        const remaining = MAX_TRAIT_NFT_SCAN - ownershipSlots.length;
        const count = Number(balance < BigInt(remaining) ? balance : BigInt(remaining));
        for (let index = 0; index < count; index += 1) {
          ownershipSlots.push({ address: walletAddresses[walletIndex]!, index: BigInt(index) });
        }
        if (ownershipSlots.length >= MAX_TRAIT_NFT_SCAN) break;
      }

      let matches = 0;
      for (let offset = 0; offset < ownershipSlots.length; offset += TRAIT_SCAN_BATCH) {
        const batch = ownershipSlots.slice(offset, offset + TRAIT_SCAN_BATCH);
        const tokenIds = await Promise.all(
          batch.map((slot) =>
            client.readContract({
              address: traitRule.contractAddress,
              abi: erc721TraitAbi,
              functionName: "tokenOfOwnerByIndex",
              args: [slot.address, slot.index]
            })
          )
        );
        const tokenUris = await Promise.all(
          tokenIds.map((tokenId) =>
            client.readContract({
              address: traitRule.contractAddress,
              abi: erc721TraitAbi,
              functionName: "tokenURI",
              args: [tokenId]
            })
          )
        );
        const attributes = await Promise.all(
          tokenIds.map((tokenId, index) =>
            loadTokenAttributes(
              env,
              rule.chainId,
              traitRule.contractAddress,
              tokenId,
              tokenUris[index]!
            )
          )
        );
        matches += attributes.filter((items) =>
          metadataHasTrait(items, traitRule.traitName, traitRule.traitValue)
        ).length;
        if (matches >= traitRule.minCount) {
          return { rule, qualifies: true, balance: matches.toString() };
        }
      }

      if (total > BigInt(ownershipSlots.length)) {
        throw new Error(
          `Trait scan stopped at ${MAX_TRAIT_NFT_SCAN} NFTs. Configure an indexer for larger wallets.`
        );
      }
      return { rule, qualifies: false, balance: matches.toString() };
    }

    if (rule.definition.type === "erc721") {
      return {
        rule,
        qualifies: total >= BigInt(rule.definition.minCount),
        balance: total.toString()
      };
    }

    const decimals = await client.readContract({
      address: rule.definition.contractAddress,
      abi: erc20Abi,
      functionName: "decimals"
    });
    return {
      rule,
      qualifies: total >= parseUnits(rule.definition.minAmount, decimals),
      balance: total.toString()
    };
  } catch (error) {
    return { rule, error: error instanceof Error ? error.message : "RPC request failed." };
  }
}

async function evaluateSolanaRule(
  rule: RoleRuleRecord,
  walletAddresses: string[],
  rpcUrl: string
): Promise<RuleOutcome> {
  if (rule.definition.type !== "spl-token") {
    return { rule, error: "An EVM rule cannot be evaluated by a Solana provider." };
  }
  if (walletAddresses.length === 0) return { rule, qualifies: false, balance: "0" };
  try {
    const result = await solanaTokenQualifies(
      rpcUrl,
      walletAddresses,
      rule.definition.mintAddress,
      rule.definition.minAmount
    );
    return { rule, ...result };
  } catch (error) {
    return { rule, error: error instanceof Error ? error.message : "Solana RPC request failed." };
  }
}

async function changeDiscordRole(
  env: Env,
  guildId: string,
  discordUserId: string,
  roleId: string,
  action: "add" | "remove"
): Promise<void> {
  const response = await fetchDiscordWithRetry(
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
    {
      method: action === "add" ? "PUT" : "DELETE",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "X-Audit-Log-Reason": encodeURIComponent(`${env.APP_NAME} holder verification`)
      }
    }
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord rejected the role ${action} (${response.status}): ${body.slice(0, 300)}`);
  }
}

function discordRetryDelay(response: Response, attempt: number): Promise<number> {
  const header = response.headers.get("Retry-After");
  let headerDelay: number | undefined;
  if (header) {
    const seconds = Number(header);
    headerDelay = Number.isFinite(seconds)
      ? seconds * 1_000
      : Math.max(0, Date.parse(header) - Date.now());
  }

  return response
    .clone()
    .json<{ retry_after?: number | string }>()
    .then((body) => {
      const seconds = Number(body.retry_after);
      const bodyDelay = Number.isFinite(seconds) ? seconds * 1_000 : undefined;
      return Math.min(
        Math.max(0, headerDelay ?? bodyDelay ?? 100 * 2 ** attempt),
        DISCORD_MAX_RETRY_DELAY_MS
      );
    })
    .catch(() =>
      Math.min(
        Math.max(0, headerDelay ?? 100 * 2 ** attempt),
        DISCORD_MAX_RETRY_DELAY_MS
      )
    );
}

async function fetchDiscordWithRetry(input: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < DISCORD_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(input, init);
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === DISCORD_MAX_ATTEMPTS - 1) return response;

    const delay = await discordRetryDelay(response, attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error("Discord request exhausted its retry attempts.");
}

async function getDiscordMemberRoles(
  env: Env,
  guildId: string,
  discordUserId: string
): Promise<Set<string>> {
  const response = await fetchDiscordWithRetry(
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`,
    { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
  );
  if (!response.ok) throw new Error(`Discord member lookup failed (${response.status}).`);
  const member = (await response.json()) as { roles?: string[] };
  return new Set(member.roles ?? []);
}

export type RoleSyncSummary = {
  added: string[];
  removed: string[];
  unchanged: string[];
  qualified: string[];
  errors: Array<{ roleId: string; message: string }>;
};

export type RoleDecision = "add" | "remove" | "unchanged" | "error";

export function decideRoleAction(
  outcomes: Array<{ qualifies?: boolean; error?: string }>,
  hasRole: boolean,
  matchMode: RuleMatchMode = "any"
): RoleDecision {
  const hasError = outcomes.some((outcome) => outcome.error);
  const hasFalse = outcomes.some((outcome) => outcome.qualifies === false);
  const qualifies = matchMode === "all"
    ? outcomes.length > 0 && outcomes.every((outcome) => outcome.qualifies === true)
    : outcomes.some((outcome) => outcome.qualifies === true);
  const unresolved = matchMode === "all" ? hasError && !hasFalse : hasError && !qualifies;
  if (unresolved) return "error";
  if (qualifies && !hasRole) return "add";
  if (!qualifies && hasRole) return "remove";
  return "unchanged";
}

export async function syncMemberRoles(
  env: Env,
  guildId: string,
  discordUserId: string,
  options: { bypassOwnershipCache?: boolean } = {}
): Promise<RoleSyncSummary> {
  const [rules, retiredRoleIds] = await Promise.all([
    listRoleRules(env, guildId),
    listRetiredRoleIds(env, guildId)
  ]);
  const summary: RoleSyncSummary = {
    added: [],
    removed: [],
    unchanged: [],
    qualified: [],
    errors: []
  };
  if (rules.length === 0 && retiredRoleIds.length === 0) return summary;

  const currentRolesPromise = getDiscordMemberRoles(env, guildId, discordUserId);
  const [walletRows, chains] = rules.length > 0
    ? await Promise.all([
        env.DB.prepare("SELECT chain, address FROM wallets WHERE discord_user_id = ?")
          .bind(discordUserId)
          .all<WalletRow>(),
        listChains(env)
      ])
    : [{ results: [] as WalletRow[] }, []];
  const currentRoles = await currentRolesPromise;
  const evmWallets = walletRows.results
    .filter((wallet) => wallet.chain === "evm")
    .map((wallet) => wallet.address)
    .filter((address): address is Address => isAddress(address))
    .map(getAddress);
  const solanaWallets = walletRows.results
    .filter((wallet) => wallet.chain === "solana" && isSolanaAddress(wallet.address))
    .map((wallet) => wallet.address);
  const chainById = new Map(chains.map((chain) => [chain.id, chain]));
  const outcomes = await Promise.all(
    rules.map(async (rule) => {
      const chain = chainById.get(rule.chainId);
      const rpcUrl = chain?.defaultRpcUrl;
      if (!rpcUrl || !chain) {
        return { rule, error: "No RPC URL is configured for this chain." };
      }
      const wallets = chain.family === "solana" ? solanaWallets : evmWallets;
      const cacheKey = await buildOwnershipCacheKey(
        rule,
        chain.chainReference,
        rpcUrl,
        wallets
      );
      if (!options.bypassOwnershipCache) {
        const cached = await readOwnershipCache(env, cacheKey, rule);
        if (cached) return cached;
      }
      let outcome: RuleOutcome;
      if (chain.family === "solana") {
        outcome = await evaluateSolanaRule(rule, solanaWallets, rpcUrl);
      } else {
        const numericChainId = Number(chain.chainReference);
        outcome = Number.isSafeInteger(numericChainId)
          ? await evaluateRule(env, rule, evmWallets, rpcUrl, numericChainId)
          : { rule, error: "The configured EVM chain ID is invalid." };
      }
      await writeOwnershipCache(env, cacheKey, outcome);
      return outcome;
    })
  );

  const byRole = new Map<string, RuleOutcome[]>();
  for (const outcome of outcomes) {
    const group = byRole.get(outcome.rule.roleId) ?? [];
    group.push(outcome);
    byRole.set(outcome.rule.roleId, group);
  }
  for (const roleId of retiredRoleIds) {
    if (!byRole.has(roleId)) byRole.set(roleId, []);
  }

  for (const [roleId, group] of byRole) {
    const hasRole = currentRoles.has(roleId);
    const matchMode = group[0]?.rule.matchMode ?? "any";
    const decision = decideRoleAction(group, hasRole, matchMode);
    const qualifies = matchMode === "all"
      ? group.length > 0 && group.every((outcome) => outcome.qualifies === true)
      : group.some((outcome) => outcome.qualifies === true);
    if (qualifies) {
      summary.qualified.push(roleId);
    }
    if (decision === "error") {
      summary.errors.push({ roleId, message: "Ownership could not be checked; the existing role was left unchanged." });
      continue;
    }
    if (decision === "unchanged") {
      summary.unchanged.push(roleId);
      continue;
    }
    const action = decision;

    try {
      await changeDiscordRole(env, guildId, discordUserId, roleId, action);
      summary[action === "add" ? "added" : "removed"].push(roleId);
      await env.DB.prepare(
        "INSERT INTO role_sync_events (id, guild_id, discord_user_id, role_id, action, reason) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(
          crypto.randomUUID(),
          guildId,
          discordUserId,
          roleId,
          action,
          `Evaluated ${group.length} enabled ${matchMode.toUpperCase()} requirement(s).`
        )
        .run();
    } catch (error) {
      summary.errors.push({
        roleId,
        message: error instanceof Error ? error.message : "Discord role update failed."
      });
    }
  }
  if (summary.qualified.length > 0) {
    await accrueDailyHolderPoints(env, guildId, discordUserId, summary.qualified);
  }
  return summary;
}
