import {
  createPublicClient,
  getAddress,
  hashMessage,
  http,
  isAddress,
  parseAbi,
  verifyMessage,
  type Address,
  type Hex
} from "viem";
import { createSiweMessage } from "viem/siwe";
import { listChains } from "./chains.js";
import { recordAuditEvent, shortWalletAddress } from "./audit.js";
import { isSolanaAddress, verifySolanaMessageSignature } from "./solana.js";
import type { Env } from "./types.js";

const SESSION_LIFETIME_MS = 10 * 60 * 1000;
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const MAX_CHALLENGES_PER_SESSION = 8;
const MAX_COMPLETIONS_PER_SESSION = 12;
const EIP1271_MAGIC_VALUE = "0x1626ba7e";
const eip1271Abi = parseAbi([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"
]);

type SessionRow = {
  id: string;
  discord_user_id: string;
  guild_id: string;
  expires_at: string;
};

type ChallengeRow = {
  id: string;
  session_id: string;
  chain_id: string;
  chain_reference: string;
  address: string;
  message: string;
  expires_at: string;
  used_at: string | null;
};

export type LinkedWallet = {
  id: string;
  address: string;
  family: "evm" | "solana";
  createdAt: string;
};

export class VerificationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomNonce(byteLength = 16): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(byteLength)),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function futureIso(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString();
}

function isExpired(value: string): boolean {
  return Date.parse(value) <= Date.now();
}

async function requireSession(env: Env, token: unknown): Promise<SessionRow> {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) {
    throw new VerificationError("This verification link is invalid or incomplete.", 401);
  }

  const session = await env.DB.prepare(
    "SELECT id, discord_user_id, guild_id, expires_at FROM verification_sessions WHERE token_hash = ?"
  )
    .bind(await hashToken(token))
    .first<SessionRow>();

  if (!session || isExpired(session.expires_at)) {
    throw new VerificationError("This verification link has expired. Return to Discord and click Verify Wallet again.", 401);
  }

  return session;
}

export async function createVerificationSession(
  env: Env,
  discordUserId: string,
  guildId: string
): Promise<string> {
  const token = randomToken();
  const sessionId = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO discord_users (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(discordUserId),
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(guildId),
    env.DB.prepare(
      "INSERT INTO verification_sessions (id, token_hash, discord_user_id, guild_id, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(sessionId, await hashToken(token), discordUserId, guildId, futureIso(SESSION_LIFETIME_MS))
  ]);

  return token;
}

export async function getVerificationSession(env: Env, token: string | null): Promise<{
  expiresAt: string;
  guildId: string;
}> {
  const session = await requireSession(env, token);
  return { expiresAt: session.expires_at, guildId: session.guild_id };
}

export async function listLinkedWallets(env: Env, token: unknown): Promise<LinkedWallet[]> {
  const session = await requireSession(env, token);
  const wallets = await env.DB.prepare(
    "SELECT id, chain, address, created_at FROM wallets WHERE discord_user_id = ? ORDER BY created_at"
  )
    .bind(session.discord_user_id)
    .all<{ id: string; chain: "evm" | "solana"; address: string; created_at: string }>();
  return wallets.results.map((wallet) => ({
    id: wallet.id,
    address: wallet.address,
    family: wallet.chain,
    createdAt: wallet.created_at
  }));
}

export async function unlinkWallet(
  env: Env,
  token: unknown,
  walletId: unknown
): Promise<{ discordUserId: string; guildId: string }> {
  const session = await requireSession(env, token);
  if (typeof walletId !== "string" || walletId.length < 1 || walletId.length > 80) {
    throw new VerificationError("Choose a linked wallet to remove.");
  }
  const wallet = await env.DB.prepare(
    "SELECT chain, address FROM wallets WHERE id = ? AND discord_user_id = ?"
  )
    .bind(walletId, session.discord_user_id)
    .first<{ chain: string; address: string }>();
  if (!wallet) {
    throw new VerificationError("That wallet is no longer linked.", 404);
  }
  const result = await env.DB.prepare(
    "DELETE FROM wallets WHERE id = ? AND discord_user_id = ?"
  )
    .bind(walletId, session.discord_user_id)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new VerificationError("That wallet is no longer linked.", 404);
  }
  await recordAuditEvent(env, {
    guildId: session.guild_id,
    actorDiscordUserId: session.discord_user_id,
    subjectDiscordUserId: session.discord_user_id,
    action: "wallet_unlinked",
    detail: `${wallet.chain === "solana" ? "Solana" : "EVM"} wallet ${shortWalletAddress(wallet.address)}`
  });
  return { discordUserId: session.discord_user_id, guildId: session.guild_id };
}

export async function createWalletChallenge(
  env: Env,
  origin: string,
  input: { sessionToken?: unknown; address?: unknown; chainId?: unknown }
): Promise<{ challengeId: string; message: string }> {
  const session = await requireSession(env, input.sessionToken);
  if (typeof input.chainId !== "string") {
    throw new VerificationError("Choose a supported network.");
  }

  const chain = (await listChains(env)).find(
    (candidate) =>
      candidate.id === input.chainId &&
      (candidate.family === "evm" || candidate.family === "solana")
  );
  if (!chain) {
    throw new VerificationError("That network is not enabled.");
  }
  if (
    typeof input.address !== "string" ||
    (chain.family === "evm" ? !isAddress(input.address) : !isSolanaAddress(input.address))
  ) {
    throw new VerificationError(
      `Choose a valid ${chain.family === "solana" ? "Solana" : "EVM"} wallet address.`
    );
  }

  const reserved = await env.DB.prepare(
    `UPDATE verification_sessions
     SET challenge_count = challenge_count + 1
     WHERE id = ? AND challenge_count < ? AND expires_at > ?`
  )
    .bind(session.id, MAX_CHALLENGES_PER_SESSION, new Date().toISOString())
    .run();
  if ((reserved.meta.changes ?? 0) !== 1) {
    throw new VerificationError(
      "This private link has reached its wallet-attempt limit. Return to Discord and click Verify Wallet again.",
      429
    );
  }

  const address = chain.family === "evm" ? getAddress(input.address) : input.address;
  const challengeId = crypto.randomUUID();
  const nonce = randomNonce();
  const expiresAt = futureIso(CHALLENGE_LIFETIME_MS);
  const verificationUri = new URL("/verify", origin).toString();
  const issuedAt = new Date();
  let message: string;
  if (chain.family === "evm") {
    const numericChainId = Number(chain.chainReference);
    if (!Number.isSafeInteger(numericChainId) || numericChainId <= 0) {
      throw new VerificationError("That network has an invalid EVM chain ID.");
    }
    message = createSiweMessage({
      address: address as Address,
      chainId: numericChainId,
      domain: new URL(origin).host,
      uri: verificationUri,
      version: "1",
      nonce,
      issuedAt,
      expirationTime: new Date(expiresAt),
      requestId: challengeId,
      statement: `Link this wallet to Discord user ${session.discord_user_id} in server ${session.guild_id}. No blockchain transaction or token approval will occur.`
    });
  } else {
    message = [
      `${new URL(origin).host} wants you to sign in with your Solana account:`,
      address,
      "",
      `Link this wallet to Discord user ${session.discord_user_id} in server ${session.guild_id}. No blockchain transaction or token approval will occur.`,
      "",
      `URI: ${verificationUri}`,
      "Version: 1",
      "Chain ID: solana:mainnet",
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt.toISOString()}`,
      `Expiration Time: ${expiresAt}`,
      `Request ID: ${challengeId}`
    ].join("\n");
  }

  await env.DB.prepare(
    `INSERT INTO wallet_challenges
      (id, session_id, chain_id, chain_reference, address, nonce, message, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      challengeId,
      session.id,
      chain.id,
      chain.chainReference,
      address,
      nonce,
      message,
      expiresAt
    )
    .run();

  return { challengeId, message };
}

async function verifyContractWalletSignature(
  env: Env,
  challenge: ChallengeRow,
  signature: Hex
): Promise<boolean> {
  const chain = (await listChains(env)).find(
    (candidate) => candidate.id === challenge.chain_id && candidate.family === "evm"
  );
  if (!chain?.defaultRpcUrl) return false;
  const expectedChainId = Number(challenge.chain_reference);
  if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) return false;

  try {
    const client = createPublicClient({
      transport: http(chain.defaultRpcUrl, { retryCount: 1, timeout: 5_000 })
    });
    if ((await client.getChainId()) !== expectedChainId) return false;
    const address = challenge.address as Address;
    if (!(await client.getBytecode({ address }))) return false;
    const result = await client.readContract({
      address,
      abi: eip1271Abi,
      functionName: "isValidSignature",
      args: [hashMessage(challenge.message), signature]
    });
    return result.toLowerCase() === EIP1271_MAGIC_VALUE;
  } catch {
    return false;
  }
}

async function verifyWalletSignature(
  env: Env,
  challenge: ChallengeRow,
  signature: Hex
): Promise<boolean> {
  try {
    if (
      await verifyMessage({
        address: challenge.address as Hex,
        message: challenge.message,
        signature
      })
    ) {
      return true;
    }
  } catch {
    // Contract signatures often are not valid ECDSA byte sequences.
  }
  return verifyContractWalletSignature(env, challenge, signature);
}

export async function completeWalletChallenge(
  env: Env,
  input: { sessionToken?: unknown; challengeId?: unknown; signature?: unknown }
): Promise<{
  address: string;
  family: "evm" | "solana";
  chainId: string;
  discordUserId: string;
  guildId: string;
}> {
  const session = await requireSession(env, input.sessionToken);
  if (typeof input.challengeId !== "string" || typeof input.signature !== "string") {
    throw new VerificationError("The signed challenge is incomplete.");
  }
  const challenge = await env.DB.prepare(
    `SELECT id, session_id, chain_id, chain_reference, address, message, expires_at, used_at
     FROM wallet_challenges WHERE id = ? AND session_id = ?`
  )
    .bind(input.challengeId, session.id)
    .first<ChallengeRow>();

  if (!challenge || challenge.used_at || isExpired(challenge.expires_at)) {
    throw new VerificationError("This signature request has expired or was already used. Please try again.", 409);
  }
  const chain = (await listChains(env)).find((candidate) => candidate.id === challenge.chain_id);
  if (!chain || (chain.family !== "evm" && chain.family !== "solana")) {
    throw new VerificationError("The signature request uses an unavailable network.", 409);
  }
  if (chain.family === "evm" && !/^0x(?:[0-9a-f]{2})+$/i.test(input.signature)) {
    throw new VerificationError("The wallet returned an invalid signature.");
  }

  const reserved = await env.DB.prepare(
    `UPDATE verification_sessions
     SET completion_count = completion_count + 1
     WHERE id = ? AND completion_count < ? AND expires_at > ?`
  )
    .bind(session.id, MAX_COMPLETIONS_PER_SESSION, new Date().toISOString())
    .run();
  if ((reserved.meta.changes ?? 0) !== 1) {
    throw new VerificationError(
      "This private link has reached its signature-attempt limit. Return to Discord and click Verify Wallet again.",
      429
    );
  }

  const valid = chain.family === "solana"
    ? verifySolanaMessageSignature(challenge.address, challenge.message, input.signature)
    : await verifyWalletSignature(env, challenge, input.signature as Hex);
  if (!valid) {
    throw new VerificationError("The signature does not match the selected wallet.", 401);
  }

  const existingWallet = await env.DB.prepare(
    "SELECT discord_user_id FROM wallets WHERE chain = ? AND address = ?"
  )
    .bind(chain.family, challenge.address)
    .first<{ discord_user_id: string }>();
  if (existingWallet && existingWallet.discord_user_id !== session.discord_user_id) {
    throw new VerificationError("This wallet is already linked to another Discord account.", 409);
  }

  const consumed = await env.DB.prepare(
    "UPDATE wallet_challenges SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP"
  )
    .bind(challenge.id)
    .run();
  if ((consumed.meta.changes ?? 0) !== 1) {
    throw new VerificationError("This signature request was already used. Please try again.", 409);
  }

  if (!existingWallet) {
    try {
      await env.DB.prepare(
        "INSERT INTO wallets (id, discord_user_id, chain, address) VALUES (?, ?, ?, ?)"
      )
        .bind(crypto.randomUUID(), session.discord_user_id, chain.family, challenge.address)
        .run();
    } catch {
      throw new VerificationError("This wallet was linked by another request. Start verification again.", 409);
    }
    await recordAuditEvent(env, {
      guildId: session.guild_id,
      actorDiscordUserId: session.discord_user_id,
      subjectDiscordUserId: session.discord_user_id,
      action: "wallet_linked",
      detail: `${challenge.chain_id}: ${shortWalletAddress(challenge.address)}`
    });
  }

  await env.DB.prepare(
    `INSERT INTO guild_memberships
      (guild_id, discord_user_id, last_verified_at, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(guild_id, discord_user_id) DO UPDATE SET
       last_verified_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(session.guild_id, session.discord_user_id)
    .run();

  return {
    address: challenge.address,
    family: chain.family,
    chainId: challenge.chain_id,
    discordUserId: session.discord_user_id,
    guildId: session.guild_id
  };
}
