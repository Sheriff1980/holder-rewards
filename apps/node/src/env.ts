import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type NodeConfig = {
  port: number;
  dataDir: string;
  migrationsDir: string;
  publicAppUrl: string;
  discordBotToken: string;
  discordApplicationId?: string;
  discordClientSecret?: string;
  appName: string;
  rewardCurrencyName: string;
  dailyClaimAmount?: string;
  setupToken?: string;
};

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

export function normalizePublicAppUrl(value: string | undefined): string {
  if (!value) {
    throw new Error(
      "PUBLIC_APP_URL is required. Use your public https:// address, or http://localhost:8787 for local-only testing."
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PUBLIC_APP_URL must be a complete URL such as https://rewards.example.com.");
  }

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("PUBLIC_APP_URL must use https:// unless it points to localhost.");
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("PUBLIC_APP_URL must contain only the site address, without a path, login, query, or fragment.");
  }

  return url.origin;
}

export function buildPublicRequestUrl(publicAppUrl: string, requestTarget: string): URL {
  const incomingUrl = new URL(requestTarget, "http://holder-rewards.invalid");
  return new URL(`${incomingUrl.pathname}${incomingUrl.search}`, publicAppUrl);
}

export function loadConfig(): NodeConfig {
  loadDotEnv(process.env.ENV_FILE ?? ".env");

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error(
      "DISCORD_BOT_TOKEN is required. Put it in a .env file next to where you run this, or export it."
    );
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? "8787");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    console.error("PORT must be a whole number between 1 and 65535.");
    process.exit(1);
  }
  let publicAppUrl: string;
  try {
    publicAppUrl = normalizePublicAppUrl(process.env.PUBLIC_APP_URL);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "PUBLIC_APP_URL is invalid.");
    process.exit(1);
  }
  return {
    port,
    dataDir: process.env.DATA_DIR ?? "./data",
    migrationsDir: process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../../../migrations", import.meta.url)),
    publicAppUrl,
    discordBotToken: token,
    discordApplicationId: process.env.DISCORD_APPLICATION_ID,
    discordClientSecret: process.env.DISCORD_CLIENT_SECRET,
    appName: process.env.APP_NAME ?? "Holder Rewards",
    rewardCurrencyName: process.env.REWARD_CURRENCY_NAME ?? "Points",
    dailyClaimAmount: process.env.DAILY_CLAIM_AMOUNT,
    setupToken: process.env.SETUP_TOKEN
  };
}
