import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type NodeConfig = {
  port: number;
  dataDir: string;
  migrationsDir: string;
  discordBotToken: string;
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
  return {
    port,
    dataDir: process.env.DATA_DIR ?? "./data",
    migrationsDir: process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../../../migrations", import.meta.url)),
    discordBotToken: token,
    appName: process.env.APP_NAME ?? "Holder Rewards",
    rewardCurrencyName: process.env.REWARD_CURRENCY_NAME ?? "Points",
    dailyClaimAmount: process.env.DAILY_CLAIM_AMOUNT,
    setupToken: process.env.SETUP_TOKEN
  };
}
