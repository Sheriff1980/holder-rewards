import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@holder-rewards/worker/types";
import { createNodeD1 } from "../src/db.js";
import { applyMigrations } from "../src/migrate.js";
import {
  applyDripMigration,
  getDripMigration,
  previewDripApi,
  previewDripCsv,
  rollbackDripMigration
} from "../../worker/src/drip-migration.js";
import { getPointsBalance } from "../../worker/src/points.js";
import {
  beginHostedLogin,
  completeHostedLogin,
  requireHostedSession,
  selectHostedGuild
} from "../../worker/src/hosted.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations", import.meta.url));
const GUILD = "123456789012345678";
const OTHER_GUILD = "223456789012345678";
const MANAGER = "323456789012345678";
const MEMBER_A = "423456789012345678";
const MEMBER_B = "523456789012345678";

function testEnv(extra: Partial<Env> = {}): Env {
  const db = createNodeD1(":memory:");
  applyMigrations(db.sqlite, MIGRATIONS_DIR);
  db.sqlite.prepare("INSERT INTO guilds (id) VALUES (?)").run(GUILD);
  db.sqlite.prepare(
    "INSERT INTO guild_settings (guild_id, reward_currency_name) VALUES (?, ?)"
  ).run(GUILD, "Fragments");
  return {
    DB: db as unknown as Env["DB"],
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "bot-token",
    ...extra
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Drip migration", () => {
  it("previews, applies once, and rolls back an imported CSV batch", async () => {
    const env = testEnv();
    const preview = await previewDripCsv(env, GUILD, MANAGER, {
      sourceCurrency: "Shards",
      ratio: 2,
      csv: [
        "discord_user_id,balance",
        `${MEMBER_A},10`,
        `${MEMBER_A},5`,
        `${MEMBER_B},4`,
        "not-a-discord-id,7"
      ].join("\n")
    });

    expect(preview).toMatchObject({
      status: "preview",
      sourceCurrency: "Shards",
      targetCurrency: "Fragments",
      conversionRatio: "2",
      rowCount: 4,
      matchedCount: 2,
      skippedCount: 1,
      sourceTotal: 19,
      importTotal: 38
    });
    expect(preview.rows.some((row) => row.note === "Combined 2 duplicate rows.")).toBe(true);

    const applied = await applyDripMigration(env, GUILD, MANAGER, preview.id);
    expect(applied.status).toBe("applied");
    expect(await getPointsBalance(env, GUILD, MEMBER_A)).toBe(30);
    expect(await getPointsBalance(env, GUILD, MEMBER_B)).toBe(8);

    await applyDripMigration(env, GUILD, MANAGER, preview.id);
    expect(await getPointsBalance(env, GUILD, MEMBER_A)).toBe(30);

    const rolledBack = await rollbackDripMigration(env, GUILD, MANAGER, preview.id);
    expect(rolledBack.status).toBe("rolled_back");
    expect(await getPointsBalance(env, GUILD, MEMBER_A)).toBe(0);
    expect(await getPointsBalance(env, GUILD, MEMBER_B)).toBe(0);

    await rollbackDripMigration(env, GUILD, MANAGER, preview.id);
    expect(await getPointsBalance(env, GUILD, MEMBER_A)).toBe(0);
    await expect(getDripMigration(env, OTHER_GUILD, preview.id)).rejects.toThrow("not found");
  });

  it("reads Discord credentials and the selected balance from the Drip API", async () => {
    const env = testEnv();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      data: [{
        credentials: [{ oauthProvider: "discord", oauthAccountId: MEMBER_A }],
        balances: [{ balance: 12, currencyId: "currency-1", currencyName: "Shards" }]
      }],
      meta: { totalPages: 1 }
    })));

    const preview = await previewDripApi(env, GUILD, MANAGER, {
      realmId: "507f1f77bcf86cd799439013",
      apiKey: "read-only-api-key-for-testing",
      sourceCurrency: "Shards",
      ratio: 1
    });
    expect(preview).toMatchObject({ matchedCount: 1, sourceTotal: 12, importTotal: 12 });
  });

  it("rejects a preview when no positive valid balances can be imported", async () => {
    const env = testEnv();
    await expect(previewDripCsv(env, GUILD, MANAGER, {
      sourceCurrency: "Shards",
      ratio: 1,
      csv: [
        "discord_user_id,balance",
        "not-a-discord-id,10",
        `${MEMBER_A},0`
      ].join("\n")
    })).rejects.toThrow("No positive balances with valid Discord user IDs were found.");
  });
});

describe("hosted onboarding", () => {
  it("keeps only manageable guilds and opens the existing manager after installation", async () => {
    const env = testEnv({
      DISCORD_APPLICATION_ID: "623456789012345678",
      DISCORD_CLIENT_SECRET: "client-secret"
    });
    let installed = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/applications/@me")) {
        return Response.json({
          id: "623456789012345678",
          verify_key: "a".repeat(64)
        });
      }
      if (url.includes("/applications/623456789012345678/commands")) return Response.json([]);
      if (url.endsWith("/oauth2/token")) return Response.json({ access_token: "user-token" });
      if (url.endsWith("/users/@me")) return Response.json({ id: MANAGER });
      if (url.endsWith("/users/@me/guilds")) {
        return Response.json([
          { id: GUILD, name: "Managed", permissions: "32" },
          { id: OTHER_GUILD, name: "Not managed", permissions: "0" }
        ]);
      }
      if (url.endsWith(`/guilds/${GUILD}`)) return installed ? Response.json({ id: GUILD }) : new Response(null, { status: 404 });
      throw new Error(`Unexpected request: ${url}`);
    }));

    const loginUrl = new URL(await beginHostedLogin(env, "https://rewards.example.com"));
    const state = loginUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    const completed = await completeHostedLogin(
      env, "https://rewards.example.com", "oauth-code", state
    );
    const session = await requireHostedSession(env, completed.token);
    expect(session.guilds).toEqual([{ id: GUILD, name: "Managed" }]);

    const beforeInstall = await selectHostedGuild(env, completed.token, GUILD);
    expect(beforeInstall.installed).toBe(false);
    expect(beforeInstall.inviteUrl).toContain(`guild_id=${GUILD}`);

    installed = true;
    const afterInstall = await selectHostedGuild(env, completed.token, GUILD);
    expect(afterInstall.installed).toBe(true);
    expect(afterInstall.manageUrl).toMatch(/^\/manage\?token=/);
    await expect(selectHostedGuild(env, completed.token, OTHER_GUILD)).rejects.toThrow("permission");
  });
});
