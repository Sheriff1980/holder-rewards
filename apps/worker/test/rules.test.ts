import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOwnershipCacheKey,
  decideRoleAction,
  isUint256,
  syncMemberRoles,
  updateGroupMatchMode,
  updateRoleMatchMode,
  updateRoleRewardMultiplier
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

describe("holder reward multipliers", () => {
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
      updateRoleRewardMultiplier(env, "123456789012345678", "223456789012345678", 3)
    ).resolves.toBe(3);
    expect(bound).toEqual([3, "123456789012345678", "223456789012345678"]);
  });

  it("updates every active requirement in one group", async () => {
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
      updateGroupMatchMode(env, "123456789012345678", "223456789012345678", "Blue chips", "all")
    ).resolves.toEqual({ groupKey: "Blue chips", matchMode: "all" });
    expect(bound).toEqual(["all", "123456789012345678", "223456789012345678", "Blue chips"]);
  });

  it("rejects unsafe multiplier values", async () => {
    const env = { DB: { prepare: () => { throw new Error("should not write"); } } } as unknown as Env;
    await expect(
      updateRoleRewardMultiplier(env, "123456789012345678", "223456789012345678", 101)
    ).rejects.toThrow("between 1 and 100");
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

describe("nested requirement groups", () => {
  const GUILD = "123456789012345678";
  const ROLE = "223456789012345678";
  const USER = "323456789012345678";
  const WALLET = "0x00000000000000000000000000000000000000ff";
  const CONTRACT_A1 = "0x00000000000000000000000000000000000000a1";
  const CONTRACT_A2 = "0x00000000000000000000000000000000000000a2";
  const CONTRACT_B1 = "0x00000000000000000000000000000000000000b1";

  function groupRule(id: string, contract: string, groupKey: string, groupMode: string) {
    return {
      id,
      guild_id: GUILD,
      role_id: ROLE,
      chain: "ethereum",
      match_mode: "all",
      group_key: groupKey,
      group_match_mode: groupMode,
      reward_multiplier: 1,
      rule: JSON.stringify({ type: "erc721", contractAddress: contract, minCount: 1 })
    };
  }

  function groupEnv() {
    return {
      APP_NAME: "Holder Rewards",
      DISCORD_BOT_TOKEN: "test-token",
      DB: {
        prepare: (sql: string) => {
          const statement = {
            all: async () => {
              if (sql.includes("enabled = 1 ORDER BY")) {
                return {
                  results: [
                    groupRule("rule-a1", CONTRACT_A1, "Blue chips", "any"),
                    groupRule("rule-a2", CONTRACT_A2, "Blue chips", "any"),
                    groupRule("rule-b1", CONTRACT_B1, "Passes", "all")
                  ]
                };
              }
              if (sql.includes("SELECT DISTINCT retired.role_id")) return { results: [] };
              if (sql.includes("FROM wallets")) return { results: [{ chain: "evm", address: WALLET }] };
              if (sql.includes("FROM chain_configs")) return { results: [] };
              throw new Error(`Unexpected query: ${sql}`);
            },
            first: async () => null,
            run: async () => ({ success: true, meta: { changes: 1 } }),
            bind: () => statement
          };
          return statement;
        }
      }
    } as unknown as Env;
  }

  function stubRpcAndDiscord(balances: Map<string, bigint>, added: string[]) {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PUT") {
        added.push(url);
        return new Response(null, { status: 204 });
      }
      if (init?.method === "POST") {
        const requests = JSON.parse(String(init.body)) as
          | Array<{ id: number; method: string; params?: Array<{ to?: string }> }>
          | { id: number; method: string; params?: Array<{ to?: string }> };
        const reply = (request: { id: number; method: string; params?: Array<{ to?: string }> }) => {
          if (request.method === "eth_chainId") return { jsonrpc: "2.0", id: request.id, result: "0x1" };
          const balance = balances.get(request.params?.[0]?.to ?? "") ?? 0n;
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: `0x${balance.toString(16).padStart(64, "0")}`
          };
        };
        return Array.isArray(requests)
          ? Response.json(requests.map(reply))
          : Response.json(reply(requests));
      }
      return Response.json({ roles: [] });
    });
  }

  it("qualifies when every group passes: (A1 OR A2) AND B1", async () => {
    const added: string[] = [];
    stubRpcAndDiscord(new Map([[CONTRACT_A2, 2n], [CONTRACT_B1, 1n]]), added);
    const summary = await syncMemberRoles(groupEnv(), GUILD, USER, { bypassOwnershipCache: true });
    expect(summary.qualified).toEqual([ROLE]);
    expect(summary.added).toEqual([ROLE]);
    expect(added[0]).toContain(`/roles/${ROLE}`);
  });

  it("does not qualify when a required group fails", async () => {
    const added: string[] = [];
    stubRpcAndDiscord(new Map([[CONTRACT_A2, 2n]]), added);
    const summary = await syncMemberRoles(groupEnv(), GUILD, USER, { bypassOwnershipCache: true });
    expect(summary.qualified).toEqual([]);
    expect(summary.added).toEqual([]);
    expect(summary.unchanged).toEqual([ROLE]);
    expect(added).toHaveLength(0);
  });
});
