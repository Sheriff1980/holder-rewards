import type { Db } from "@holder-rewards/db";
import { buildWebApp } from "./server.js";
import type { AppEnv } from "@holder-rewards/env";

const env: AppEnv = {
  NODE_ENV: "test",
  PUBLIC_APP_URL: "http://localhost:3000",
  SESSION_SECRET: "local-development-secret-at-least-32-chars",
  DISCORD_BOT_TOKEN: "placeholder-token",
  DISCORD_CLIENT_ID: "placeholder-client-id",
  DISCORD_CLIENT_SECRET: "placeholder-client-secret",
  DISCORD_PUBLIC_KEY: undefined,
  DISCORD_GUILD_ID: undefined,
  DATABASE_URL: "postgres://dripclone:dripclone@localhost:5432/dripclone",
  REDIS_URL: "redis://localhost:6379",
  CHAIN_PROVIDERS: "mock",
  SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com",
  SOLANA_HELIUS_API_KEY: undefined,
  EVM_RPC_URL: "https://example.com",
  ALCHEMY_API_KEY: undefined,
  SIMPLEHASH_API_KEY: undefined,
  APP_NAME: "Holder Rewards",
  REWARD_CURRENCY_NAME: "Points"
};

const db = {
  query: async () => ({ rows: [{ ok: 1 }] })
} as unknown as Db;
const app = buildWebApp({ env, db });
const response = await app.inject({
  method: "GET",
  url: "/verify?guild_id=demo"
});

if (response.statusCode !== 200 || !response.body.includes("Holder Rewards")) {
  throw new Error(`Smoke test failed with status ${response.statusCode}.`);
}

const unsafeGuildId = "<script>alert('xss')</script>";
const escapedResponse = await app.inject({
  method: "GET",
  url: `/verify?guild_id=${encodeURIComponent(unsafeGuildId)}`
});

if (escapedResponse.body.includes(unsafeGuildId) || !escapedResponse.body.includes("&lt;script&gt;")) {
  throw new Error("Smoke test failed: guild ID was not safely escaped.");
}

const unhealthyApp = buildWebApp({
  env,
  db: {
    query: async () => {
      throw new Error("database unavailable");
    }
  } as unknown as Db
});
const unhealthyResponse = await unhealthyApp.inject({ method: "GET", url: "/health" });

if (unhealthyResponse.statusCode !== 503) {
  throw new Error(`Smoke test failed: unhealthy status was ${unhealthyResponse.statusCode}.`);
}

await app.close();
await unhealthyApp.close();
console.log("Web smoke test passed.");
