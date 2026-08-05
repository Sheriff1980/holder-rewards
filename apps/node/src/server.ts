import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import worker from "@holder-rewards/worker";
import type { Env } from "@holder-rewards/worker/types";
import { createNodeD1 } from "./db.js";
import { applyMigrations } from "./migrate.js";
import { buildPublicRequestUrl, loadConfig } from "./env.js";

const SCHEDULE_INTERVAL_MS = 15 * 60 * 1000;
const SCHEDULE_START_DELAY_MS = 30 * 1000;

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const db = createNodeD1(join(config.dataDir, "holder-rewards.db"));
const applied = applyMigrations(db.sqlite, config.migrationsDir);
if (applied > 0) console.log(`Applied ${applied} database migration(s).`);

const env: Env = {
  DB: db as unknown as Env["DB"],
  APP_NAME: config.appName,
  REWARD_CURRENCY_NAME: config.rewardCurrencyName,
  DAILY_CLAIM_AMOUNT: config.dailyClaimAmount,
  DISCORD_BOT_TOKEN: config.discordBotToken,
  DISCORD_APPLICATION_ID: config.discordApplicationId,
  DISCORD_CLIENT_SECRET: config.discordClientSecret,
  SETUP_TOKEN: config.setupToken
};

const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    const method = req.method ?? "GET";
    const requestUrl = buildPublicRequestUrl(config.publicAppUrl, req.url ?? "/");
    const request = new Request(requestUrl, {
      method,
      headers,
      body: body.length > 0 && method !== "GET" && method !== "HEAD" ? body : undefined
    });

    const pending: Promise<unknown>[] = [];
    const response = await worker.fetch(request, env, {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      passThroughOnException: () => undefined
    } as unknown as ExecutionContext);

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
    await Promise.allSettled(pending);
  } catch (error) {
    console.error("Request failed", error);
    if (!res.headersSent) res.writeHead(500);
    res.end("Internal server error");
  }
});

async function runScheduled(): Promise<void> {
  if (scheduledRunActive) {
    console.warn("Skipping scheduled job because the previous run is still active.");
    return;
  }
  scheduledRunActive = true;
  try {
    await worker.scheduled({} as unknown as ScheduledController, env);
  } catch (error) {
    console.error("Scheduled job failed", error);
  } finally {
    scheduledRunActive = false;
  }
}

let scheduledRunActive = false;

server.listen(config.port, () => {
  console.log(`${config.appName} listening on http://localhost:${config.port}`);
  console.log(`Public app URL: ${config.publicAppUrl}`);
  setTimeout(() => void runScheduled(), SCHEDULE_START_DELAY_MS);
  setInterval(() => void runScheduled(), SCHEDULE_INTERVAL_MS);
});
