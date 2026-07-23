import { BUILTIN_CHAINS, isBuiltinChainId, type ChainDefinition } from "./chain-registry.js";
import type { Env } from "./types.js";

type CustomChainRow = {
  id: string;
  family: "evm" | "solana";
  name: string;
  chain_reference: string;
  native_currency_symbol: string;
  rpc_url: string | null;
  explorer_url: string | null;
};

export type CustomChainInput = {
  id?: unknown;
  family?: unknown;
  name?: unknown;
  chainReference?: unknown;
  nativeCurrencySymbol?: unknown;
  rpcUrl?: unknown;
  explorerUrl?: unknown;
};

type ParseResult =
  | { success: true; chain: ChainDefinition }
  | { success: false; error: string };

function parseHttpsUrl(value: unknown, field: string, required: boolean): string | undefined | ParseResult {
  if ((value === undefined || value === "") && !required) {
    return undefined;
  }
  if (typeof value !== "string") {
    return { success: false, error: `${field} must be an HTTPS URL.` };
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      return { success: false, error: `${field} must be an HTTPS URL without embedded credentials.` };
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return { success: false, error: `${field} must be a valid HTTPS URL.` };
  }
}

export function parseCustomChain(input: CustomChainInput): ParseResult {
  if (typeof input.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,48}$/.test(input.id)) {
    return { success: false, error: "id must be a lowercase slug between 2 and 49 characters." };
  }
  if (isBuiltinChainId(input.id)) {
    return { success: false, error: "Built-in chain IDs cannot be replaced." };
  }
  if (input.family !== "evm") {
    return { success: false, error: "Only EVM-compatible custom networks are available right now." };
  }
  if (typeof input.name !== "string" || input.name.trim().length < 2 || input.name.length > 60) {
    return { success: false, error: "name must be between 2 and 60 characters." };
  }
  if (typeof input.chainReference !== "string" || input.chainReference.length > 80) {
    return { success: false, error: "chainReference is required." };
  }
  if (input.family === "evm" && !/^[1-9][0-9]*$/.test(input.chainReference)) {
    return { success: false, error: "EVM chainReference must be a positive numeric chain ID." };
  }
  if (!/^[A-Z0-9]{2,10}$/.test(String(input.nativeCurrencySymbol ?? ""))) {
    return { success: false, error: "nativeCurrencySymbol must contain 2-10 uppercase letters or numbers." };
  }

  const rpcUrl = parseHttpsUrl(input.rpcUrl, "rpcUrl", true);
  if (typeof rpcUrl === "object") {
    return rpcUrl;
  }
  const explorerUrl = parseHttpsUrl(input.explorerUrl, "explorerUrl", false);
  if (typeof explorerUrl === "object") {
    return explorerUrl;
  }

  return {
    success: true,
    chain: {
      id: input.id,
      family: "evm",
      name: input.name.trim(),
      chainReference: input.chainReference,
      nativeCurrencySymbol: String(input.nativeCurrencySymbol),
      defaultRpcUrl: rpcUrl,
      explorerUrl,
      builtin: false
    }
  };
}

export async function listChains(env: Env): Promise<ChainDefinition[]> {
  const custom = await env.DB.prepare(
    "SELECT id, family, name, chain_reference, native_currency_symbol, rpc_url, explorer_url FROM chain_configs WHERE enabled = 1 ORDER BY name"
  ).all<CustomChainRow>();

  return [
    ...BUILTIN_CHAINS.filter((chain) => chain.family === "evm" || chain.family === "solana"),
    ...custom.results.filter((row) => row.family === "evm").map((row) => ({
      id: row.id,
      family: row.family,
      name: row.name,
      chainReference: row.chain_reference,
      nativeCurrencySymbol: row.native_currency_symbol,
      defaultRpcUrl: row.rpc_url ?? undefined,
      explorerUrl: row.explorer_url ?? undefined,
      builtin: false
    }))
  ];
}

export async function saveCustomChain(env: Env, chain: ChainDefinition): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO chain_configs
      (id, family, name, chain_reference, native_currency_symbol, rpc_url, explorer_url, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       family = excluded.family,
       name = excluded.name,
       chain_reference = excluded.chain_reference,
       native_currency_symbol = excluded.native_currency_symbol,
       rpc_url = excluded.rpc_url,
       explorer_url = excluded.explorer_url,
       enabled = 1,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      chain.id,
      chain.family,
      chain.name,
      chain.chainReference,
      chain.nativeCurrencySymbol,
      chain.defaultRpcUrl ?? null,
      chain.explorerUrl ?? null
    )
    .run();
}
