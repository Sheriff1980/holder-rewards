import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "@holder-rewards/worker";
import type { Env } from "@holder-rewards/worker/types";
import { createNodeD1 } from "../src/db.js";
import { applyMigrations } from "../src/migrate.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations", import.meta.url));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("D1 shim", () => {
  it("supports the app's query shapes", async () => {
    const db = createNodeD1(":memory:");
    await db.exec("CREATE TABLE items (id TEXT PRIMARY KEY, n INTEGER)");
    await db.prepare("INSERT INTO items (id, n) VALUES (?, ?)").bind("a", 1).run();
    await db.prepare("INSERT INTO items (id, n) VALUES (?, ?)").bind("b", 2).run();

    const first = await db.prepare("SELECT n FROM items WHERE id = ?").bind("a").first<{ n: number }>();
    expect(first).toEqual({ n: 1 });
    const all = await db.prepare("SELECT id FROM items ORDER BY id").all<{ id: string }>();
    expect(all.results).toEqual([{ id: "a" }, { id: "b" }]);

    const updated = await db.prepare("UPDATE items SET n = n + 10 WHERE id = ?").bind("b").run();
    expect(updated.meta.changes).toBe(1);
    const missing = await db.prepare("SELECT n FROM items WHERE id = ?").bind("nope").first();
    expect(missing).toBeNull();
  });

  it("rolls back a failed batch atomically", async () => {
    const db = createNodeD1(":memory:");
    await db.exec("CREATE TABLE items (id TEXT PRIMARY KEY)");
    await db.batch([
      db.prepare("INSERT INTO items (id) VALUES (?)").bind("a"),
      db.prepare("INSERT INTO items (id) VALUES (?)").bind("b")
    ]);
    await expect(
      db.batch([
        db.prepare("INSERT INTO items (id) VALUES (?)").bind("c"),
        db.prepare("INSERT INTO items (id) VALUES (?)").bind("a")
      ])
    ).rejects.toThrow();

    const rows = await db.prepare("SELECT id FROM items ORDER BY id").all<{ id: string }>();
    expect(rows.results).toEqual([{ id: "a" }, { id: "b" }]);
  });
});

describe("migrations", () => {
  it("applies the full set once and reports zero on the second run", () => {
    const db = createNodeD1(":memory:");
    const applied = applyMigrations(db.sqlite, MIGRATIONS_DIR);
    expect(applied).toBeGreaterThanOrEqual(27);
    expect(applyMigrations(db.sqlite, MIGRATIONS_DIR)).toBe(0);

    const tables = db.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = new Set(tables.map((row) => row.name));
    for (const required of ["role_rules", "point_transactions", "quests", "raffles", "store_items", "sales_watches", "indexer_configs"]) {
      expect(names.has(required)).toBe(true);
    }
    const settingsColumns = db.sqlite.prepare("PRAGMA table_info(guild_settings)").all() as Array<{ name: string }>;
    expect(settingsColumns.some((column) => column.name === "tip_daily_limit")).toBe(true);
    const ruleColumns = db.sqlite.prepare("PRAGMA table_info(role_rules)").all() as Array<{ name: string }>;
    expect(ruleColumns.some((column) => column.name === "group_key")).toBe(true);
  });
});

describe("worker over the Node host", () => {
  function nodeEnv(): Env {
    const dir = mkdtempSync(join(tmpdir(), "holder-rewards-node-test-"));
    const db = createNodeD1(join(dir, "test.db"));
    applyMigrations(db.sqlite, MIGRATIONS_DIR);
    return {
      DB: db as unknown as Env["DB"],
      APP_NAME: "Holder Rewards",
      REWARD_CURRENCY_NAME: "Points",
      DISCORD_BOT_TOKEN: "test-token"
    };
  }

  const context = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined
  } as unknown as ExecutionContext;

  it("serves health checks from the same handler", async () => {
    const response = await worker.fetch(new Request("http://localhost/health"), nodeEnv(), context);
    expect(response.status).toBe(200);
  });

  it("renders the setup page even when Discord is unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const response = await worker.fetch(new Request("http://localhost/"), nodeEnv(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
  });
});
