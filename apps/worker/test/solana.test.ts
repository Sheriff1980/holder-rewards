import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isSolanaAddress, solanaTokenQualifies } from "../src/solana.js";

function address(): string {
  return bs58.encode(nacl.sign.keyPair().publicKey);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Solana ownership", () => {
  it("recognizes 32-byte base58 public keys", () => {
    expect(isSolanaAddress(address())).toBe(true);
    expect(isSolanaAddress("not-a-wallet")).toBe(false);
  });

  it("sums parsed SPL balances across linked wallets using mint-filtered RPC calls", async () => {
    const owners = [address(), address()];
    const mint = address();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      expect(request.method).toBe("getTokenAccountsByOwner");
      expect(request.params[1]).toEqual({ mint });
      const amount = request.params[0] === owners[0] ? "1250000" : "800000";
      return Response.json({
        jsonrpc: "2.0",
        id: "test",
        result: {
          context: { slot: 1 },
          value: [{
            account: {
              data: {
                parsed: { info: { tokenAmount: { amount, decimals: 6 } } }
              }
            }
          }]
        }
      });
    });

    await expect(
      solanaTokenQualifies("https://api.mainnet-beta.solana.com", owners, mint, "2.05")
    ).resolves.toEqual({ qualifies: true, balance: "2050000" });
    await expect(
      solanaTokenQualifies("https://api.mainnet-beta.solana.com", owners, mint, "2.050001")
    ).resolves.toEqual({ qualifies: false, balance: "2050000" });
  });

  it("fails closed when the RPC response is unusable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { message: "rate limited" } }));
    await expect(
      solanaTokenQualifies("https://api.mainnet-beta.solana.com", [address()], address(), "1")
    ).rejects.toThrow("rate limited");
  });

  it("aborts a Solana RPC request that exceeds the provider timeout", async () => {
    vi.useFakeTimers();
    const requestSignals: AbortSignal[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          requestSignals.push(signal);
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true
          });
        })
    );

    const ownership = solanaTokenQualifies(
      "https://api.mainnet-beta.solana.com",
      [address()],
      address(),
      "1"
    );
    const rejection = expect(ownership).rejects.toThrow("Solana RPC timed out after 5 seconds.");

    expect(requestSignals).toHaveLength(1);
    expect(requestSignals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(requestSignals[0]?.aborted).toBe(true);
    await rejection;
  });
});
