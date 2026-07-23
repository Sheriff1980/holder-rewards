import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOwnershipCacheKey,
  decideRoleAction,
  isUint256,
  syncMemberRoles,
  updateRoleMatchMode
} from "../src/rules.js";
import type { Env } from "../src/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("holder role decisions", () => {
  it("adds a role when any rule for it qualifies", () => {
    expect(
      decideRoleAction([{ qualifies: false }, { error: "provider timeout" }, { qualifies: true }], false)
    ).toBe("add");
  });

  it("removes a role only when every rule completed and failed", () => {
    expect(decideRoleAction([{ qualifies: false }, { qualifies: false }], true)).toBe("remove");
  });

  it("preserves a role when no rule qualifies and a provider failed", () => {
    expect(decideRoleAction([{ qualifies: false }, { error: "provider timeout" }], true)).toBe("error");
  });

  it("leaves an already-correct qualifying role unchanged", () => {
    expect(decideRoleAction([{ qualifies: true }], true)).toBe("unchanged");
  });

  it("adds an all-mode role only when every requirement qualifies", () => {
    expect(decideRoleAction([{ qualifies: true }, { qualifies: true }], false, "all")).toBe("add");
    expect(decideRoleAction([{ qualifies: true }, { qualifies: false }], false, "all")).toBe("unchanged");
  });

  it("preserves an all-mode role when the only missing result is a provider error", () => {
    expect(decideRoleAction([{ qualifies: true }, { error: "provider timeout" }], true, "all")).toBe("error");
  });

  it("can safely remove an all-mode role when one requirement is confirmed false", () => {
    expect(
      decideRoleAction([{ qualifies: false }, { error: "different provider timeout" }], true, "all")
    ).toBe("remove");
  });
});

describe("EVM token IDs", () => {
  it("accepts the complete uint256 range without number coercion", () => {
    const maximum = ((1n << 256n) - 1n).toString();
    expect(isUint256("0")).toBe(true);
    expect(isUint256(maximum)).toBe(true);
    expect(isUint256((1n << 256n).toString())).toBe(false);
  });

  it("rejects malformed IDs and enforces positive balances", () => {
    expect(isUint256("-1")).toBe(false);
    expect(isUint256("1e18")).toBe(false);
    expect(isUint256("01")).toBe(false);
    expect(isUint256("0", true)).toBe(false);
    expect(isUint256("1", true)).toBe(true);
  });
});

describe("role requirement modes", () => {
  it("updates every active requirement for one server role", async () => {
    let bound: unknown[] = [];
    const env = {
      DB: {
        prepare: () => ({
          bind: (...values: unknown[]) => {
            bound = values;
            return { run: async () => ({ success: true, meta: { changes: 2 } }) };
          }
        })
      }
    } as unknown as Env;

    await expect(
      updateRoleMatchMode(env, "123456789012345678", "223456789012345678", "all")
    ).resolves.toBe("all");
    expect(bound).toEqual(["all", "123456789012345678", "223456789012345678"]);
  });

  it("rejects invalid modes before writing", async () => {
    const env = { DB: { prepare: () => { throw new Error("should not write"); } } } as unknown as Env;
    await expect(
      updateRoleMatchMode(env, "123456789012345678", "223456789012345678", "sometimes")
    ).rejects.toThrow("any or all");
  });
});

describe("retired holder roles", () => {
  it("removes a previously managed role after its final rule is disabled", async () => {
    const roleId = "223456789012345678";
    const statements: string[] = [];
    const env = {
      APP_NAME: "Holder Rewards",
      DISCORD_BOT_TOKEN: "test-token",
      DB: {
        prepare: (sql: string) => {
          statements.push(sql);
          return {
            bind: (...values: unknown[]) => ({
              all: async () => {
                if (sql.includes("enabled = 1 ORDER BY")) return { results: [] };
                if (sql.includes("SELECT DISTINCT retired.role_id")) {
                  expect(values).toEqual(["123456789012345678"]);
                  return { results: [{ role_id: roleId }] };
                }
                throw new Error(`Unexpected query: ${sql}`);
              },
              run: async () => ({ success: true, meta: { changes: 1 } })
            })
          };
        }
      }
    } as unknown as Env;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        expect(url).toContain(`/roles/${roleId}`);
        return new Response(null, { status: 204 });
      }
      expect(url).toContain("/members/323456789012345678");
      return Response.json({ roles: [roleId] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncMemberRoles(
        env,
        "123456789012345678",
        "323456789012345678"
      )
    ).resolves.toEqual({
      added: [],
      removed: [roleId],
      unchanged: [],
      qualified: [],
      errors: []
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(statements.some((sql) => sql.includes("INSERT INTO role_sync_events"))).toBe(true);
  });

  it("recovers from Discord rate limits during member lookup and role removal", async () => {
    const roleId = "223456789012345678";
    const env = {
      APP_NAME: "Holder Rewards",
      DISCORD_BOT_TOKEN: "test-token",
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            all: async () => {
              if (sql.includes("enabled = 1 ORDER BY")) return { results: [] };
              if (sql.includes("SELECT DISTINCT retired.role_id")) {
                return { results: [{ role_id: roleId }] };
              }
              throw new Error(`Unexpected query: ${sql}`);
            },
            run: async () => ({ success: true, meta: { changes: 1 } })
          })
        })
      }
    } as unknown as Env;
    let memberAttempts = 0;
    let roleAttempts = 0;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        roleAttempts += 1;
        if (roleAttempts === 1) {
          return Response.json({ retry_after: 0 }, { status: 429 });
        }
        return new Response(null, { status: 204 });
      }

      memberAttempts += 1;
      if (memberAttempts === 1) {
        return new Response("", { status: 429, headers: { "Retry-After": "0" } });
      }
      return Response.json({ roles: [roleId] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncMemberRoles(env, "123456789012345678", "323456789012345678")
    ).resolves.toEqual({
      added: [],
      removed: [roleId],
      unchanged: [],
      qualified: [],
      errors: []
    });
    expect(memberAttempts).toBe(2);
    expect(roleAttempts).toBe(2);
  });

  it("does not retry a permanent Discord rejection or remove the role locally", async () => {
    const roleId = "223456789012345678";
    const env = {
      APP_NAME: "Holder Rewards",
      DISCORD_BOT_TOKEN: "test-token",
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            all: async () => {
              if (sql.includes("enabled = 1 ORDER BY")) return { results: [] };
              if (sql.includes("SELECT DISTINCT retired.role_id")) {
                return { results: [{ role_id: roleId }] };
              }
              throw new Error(`Unexpected query: ${sql}`);
            },
            run: async () => ({ success: true, meta: { changes: 1 } })
          })
        })
      }
    } as unknown as Env;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response("Missing Permissions", { status: 403 });
      }
      return Response.json({ roles: [roleId] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncMemberRoles(env, "123456789012345678", "323456789012345678")
    ).resolves.toEqual({
      added: [],
      removed: [],
      unchanged: [],
      qualified: [],
      errors: [
        {
          roleId,
          message: "Discord rejected the role remove (403): Missing Permissions"
        }
      ]
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not call Discord when the server has never had a managed role", async () => {
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({
            all: async () => {
              if (sql.includes("enabled = 1 ORDER BY")) return { results: [] };
              if (sql.includes("SELECT DISTINCT retired.role_id")) return { results: [] };
              throw new Error(`Unexpected query: ${sql}`);
            }
          })
        })
      }
    } as unknown as Env;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncMemberRoles(
        env,
        "123456789012345678",
        "323456789012345678"
      )
    ).resolves.toEqual({
      added: [],
      removed: [],
      unchanged: [],
      qualified: [],
      errors: []
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ownership cache keys", () => {
  const rule = {
    chainId: "solana",
    definition: {
      type: "spl-token" as const,
      mintAddress: "So11111111111111111111111111111111111111112",
      minAmount: "1"
    }
  };

  it("is stable regardless of linked-wallet order", async () => {
    const left = await buildOwnershipCacheKey(
      rule,
      "mainnet-beta",
      "https://api.mainnet-beta.solana.com",
      ["wallet-b", "wallet-a"]
    );
    const right = await buildOwnershipCacheKey(
      rule,
      "mainnet-beta",
      "https://api.mainnet-beta.solana.com",
      ["wallet-a", "wallet-b"]
    );
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when wallets or provider configuration changes", async () => {
    const baseline = await buildOwnershipCacheKey(
      rule,
      "mainnet-beta",
      "https://api.mainnet-beta.solana.com",
      ["wallet-a"]
    );
    await expect(
      buildOwnershipCacheKey(rule, "mainnet-beta", "https://different.example", ["wallet-a"])
    ).resolves.not.toBe(baseline);
    await expect(
      buildOwnershipCacheKey(rule, "mainnet-beta", "https://api.mainnet-beta.solana.com", ["wallet-b"])
    ).resolves.not.toBe(baseline);
  });
});
