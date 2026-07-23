import bs58 from "bs58";
import nacl from "tweetnacl";

const SOLANA_RPC_TIMEOUT_MS = 5_000;

export function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

function decodeBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 100) return null;
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function verifySolanaMessageSignature(
  address: string,
  message: string,
  signature: string
): boolean {
  if (!isSolanaAddress(address)) return false;
  const signatureBytes = decodeBase64(signature);
  if (!signatureBytes || signatureBytes.length !== nacl.sign.signatureLength) return false;
  return nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    signatureBytes,
    bs58.decode(address)
  );
}

type TokenAccountResponse = {
  result?: {
    value?: Array<{
      account?: {
        data?: {
          parsed?: {
            info?: {
              tokenAmount?: { amount?: string; decimals?: number };
            };
          };
        };
      };
    }>;
  };
  error?: { message?: string };
};

async function tokenAccounts(
  rpcUrl: string,
  owner: string,
  mint: string
): Promise<Array<{ amount: bigint; decimals: number }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOLANA_RPC_TIMEOUT_MS);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "getTokenAccountsByOwner",
        params: [owner, { mint }, { commitment: "confirmed", encoding: "jsonParsed" }]
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Solana RPC returned ${response.status}.`);
    const body = (await response.json()) as TokenAccountResponse;
    if (body.error || !Array.isArray(body.result?.value)) {
      throw new Error(body.error?.message ?? "Solana RPC returned an invalid token-account response.");
    }
    return body.result.value.flatMap((entry) => {
      const amount = entry.account?.data?.parsed?.info?.tokenAmount?.amount;
      const decimals = entry.account?.data?.parsed?.info?.tokenAmount?.decimals;
      return typeof amount === "string" && /^[0-9]+$/.test(amount) && Number.isSafeInteger(decimals)
        ? [{ amount: BigInt(amount), decimals: decimals as number }]
        : [];
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Solana RPC timed out after 5 seconds.", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function minimumRawAmount(value: string, decimals: number): bigint | null {
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) return null;
  const padded = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export async function solanaTokenQualifies(
  rpcUrl: string,
  owners: string[],
  mint: string,
  minimum: string
): Promise<{ qualifies: boolean; balance: string }> {
  if (!isSolanaAddress(mint) || owners.some((owner) => !isSolanaAddress(owner))) {
    throw new Error("Solana wallet or mint address is invalid.");
  }
  const accounts = (await Promise.all(owners.map((owner) => tokenAccounts(rpcUrl, owner, mint)))).flat();
  if (accounts.length === 0) return { qualifies: false, balance: "0" };
  const decimals = accounts[0]!.decimals;
  if (accounts.some((account) => account.decimals !== decimals)) {
    throw new Error("Solana RPC returned inconsistent mint decimals.");
  }
  const balance = accounts.reduce((total, account) => total + account.amount, 0n);
  const minimumRaw = minimumRawAmount(minimum, decimals);
  if (minimumRaw === null) return { qualifies: false, balance: balance.toString() };
  return { qualifies: balance >= minimumRaw, balance: balance.toString() };
}
