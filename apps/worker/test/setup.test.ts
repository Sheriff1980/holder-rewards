import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureDiscordSetup } from "../src/discord.js";
import type { Env } from "../src/types.js";

class StateStatement {
  private values: unknown[] = [];

  constructor(private readonly state: Map<string, string>, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const literalKey = /key = '([^']+)'/.exec(this.sql)?.[1];
    const key = literalKey ?? String(this.values[0] ?? "");
    const value = this.state.get(key);
    return (value === undefined ? null : { value }) as T | null;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT INTO app_state")) {
      this.state.set(String(this.values[0]), String(this.values[1]));
    }
    return { success: true, meta: { changes: 1 } } as D1Result;
  }
}

function createEnv(state = new Map<string, string>()): Env {
  return {
    DB: {
      prepare: (sql: string) => new StateStatement(state, sql)
    } as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "bot-token",
    SETUP_TOKEN: "setup"
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("automatic Discord setup", () => {
  it("configures the endpoint and commands once, then uses its fingerprint", async () => {
    const state = new Map<string, string>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/applications/@me") && !init?.method) {
        return Response.json({
          id: "123456789012345678",
          verify_key: "00".repeat(32)
        });
      }
      if (url.endsWith("/applications/@me") && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({
          interactions_endpoint_url: "https://holder.example/interactions"
        });
        return Response.json({ id: "123456789012345678" });
      }
      if (url.includes("/applications/123456789012345678/commands") && init?.method === "PUT") {
        return Response.json([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const env = createEnv(state);

    await expect(ensureDiscordSetup(env, "https://holder.example")).resolves.toMatchObject({
      ready: true,
      local: false
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(state.get("public_origin")).toBe("https://holder.example");
    expect(state.get("discord_application_id")).toBe("123456789012345678");
    expect(state.get("discord_public_key")).toBe("00".repeat(32));
    expect(state.get("discord_setup_hash")).toBeTruthy();

    await expect(ensureDiscordSetup(env, "https://alternate.example")).resolves.toMatchObject({
      ready: true
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(state.get("public_origin")).toBe("https://holder.example");
  });

  it("rechecks cached credentials and reports a rotated or invalid bot token", async () => {
    const state = new Map<string, string>();
    let tokenIsValid = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/applications/@me") && !init?.method) {
        return tokenIsValid
          ? Response.json({
              id: "123456789012345678",
              verify_key: "00".repeat(32)
            })
          : new Response("Unauthorized", { status: 401 });
      }
      if (url.endsWith("/applications/@me") && init?.method === "PATCH") {
        return Response.json({ id: "123456789012345678" });
      }
      if (url.includes("/applications/123456789012345678/commands") && init?.method === "PUT") {
        return Response.json([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const env = createEnv(state);

    await expect(ensureDiscordSetup(env, "https://holder.example")).resolves.toMatchObject({
      ready: true
    });
    tokenIsValid = false;
    await expect(ensureDiscordSetup(env, "https://holder.example")).resolves.toMatchObject({
      ready: false,
      message: "Discord credentials could not be verified (401)."
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not contact Discord from a local preview", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(ensureDiscordSetup(createEnv(), "http://127.0.0.1:8787")).resolves.toMatchObject({
      ready: false,
      local: true
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
