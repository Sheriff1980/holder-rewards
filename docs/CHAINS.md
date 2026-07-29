# Chain Support

Holder Rewards separates a chain's identity from the adapter that knows how to communicate with its family. Adding another EVM network does not require another wallet-signature implementation; it uses the EVM adapter with a different numeric chain ID and RPC endpoint.

## Built-In Networks

| ID | Family | Network reference | Native currency | Default RPC |
| --- | --- | ---: | --- | --- |
| `ethereum` | EVM | `1` | ETH | `https://ethereum-rpc.publicnode.com` |
| `base` | EVM | `8453` | ETH | `https://mainnet.base.org` |
| `polygon` | EVM | `137` | POL | `https://polygon.drpc.org` |
| `arbitrum` | EVM | `42161` | ETH | `https://arb1.arbitrum.io/rpc` |
| `apechain` | EVM | `33139` | APE | `https://apechain.calderachain.xyz/http` |
| `solana` | Solana | `mainnet-beta` | SOL | `https://public.rpc.solanavibestation.com` |

The defaults are public endpoints intended for setup and light community traffic. Public RPC endpoints may be rate-limited; a failed ownership check leaves existing roles unchanged. Exact Solana mint/SPL-token checks use a keyless public RPC without another account or key. The manager automatically checks every enabled provider and offers a one-click retry when a network is unavailable.

A manager can add another EVM-compatible network with its own public RPC under **Advanced network settings**. Provider URLs containing private API keys should not be stored in the chain registry; keyed indexer endpoints have their own designated configuration below.

## Optional NFT Indexers

Everything in the default path works keyless. Two optional capabilities unlock when a manager pastes an indexer URL for a chain under `/rules manage` → **Advanced network settings**:

- **EVM NFT API (Alchemy-compatible).** Trait rules then work on large wallets and non-enumerable ERC-721 collections that the bounded direct-RPC scan cannot cover. Use the network's NFT API base URL, for example `https://eth-mainnet.g.alchemy.com/nft/v3/<your-key>`. Any provider serving the same `getNFTsForOwner` shape works.
- **Solana DAS endpoint.** Enables collection-wide Solana NFT rules ("own at least N items from this verified collection"). Use a DAS-capable RPC URL, for example a Helius endpoint such as `https://mainnet.helius-rpc.com/?api-key=<your-key>`. Any provider serving `getAssetsByOwner` works.

Indexer URLs may contain API keys. They are stored in the deployment's `indexer_configs` table as configuration, not as encrypted secrets, and are visible to anyone holding a private manager link for the deployment. Keep manager links private, prefer provider dashboards that allow key restrictions, and rotate a key if it may have leaked. The manager health check probes configured indexers alongside RPC providers and offers one-click retry.

## Demo Chain (Testing)

The built-in **Demo Chain (testing)** network exists so a new deployment can be tested end-to-end without owning any NFTs. It appears only in the browser manager's holder-rule network list. Any rule created on it qualifies for every member who has at least one linked wallet — no RPC, indexer, or real assets involved. Create a rule on it, link a wallet through the normal verification flow, and watch the role and points arrive; remove the rule when done testing. Demo Chain rules never appear in wallet linking, provider health checks, or sales watches.

## Custom Chains

Normal operators add a custom EVM-compatible network from `/rules manage` under **Advanced network settings**. Definitions are stored in the deployment's `chain_configs` table and immediately appear in the holder-rule network list.

Developers can use the protected endpoint when an optional `SETUP_TOKEN` is configured:

```text
POST /api/setup/chains
Authorization: Bearer <SETUP_TOKEN>
Content-Type: application/json
```

Example EVM definition:

```json
{
  "id": "future-chain",
  "family": "evm",
  "name": "Future Chain",
  "chainReference": "987654",
  "nativeCurrencySymbol": "FTR",
  "rpcUrl": "https://rpc.future.example",
  "explorerUrl": "https://explorer.future.example"
}
```

Use `GET /api/chains` to retrieve built-in and enabled custom definitions.

RPC URLs stored in the registry are configuration, not encrypted secrets. Do not place provider API keys, usernames, or passwords in these URLs; keyed endpoints belong in the optional indexer configuration above.

## Adding a New Family

New EVM-compatible networks can use the current adapter. Solana already implements signature verification, exact mint balances, and collection-wide NFT checks through a replaceable DAS adapter. Genuinely different chain families still require adapters implementing:

- Wallet signature verification.
- NFT ownership lookup.
- Fungible-token balance lookup.
- Address normalization and validation.
- Provider health checks and rate-limit handling.

The rest of the verification, Discord, role-rule, and rewards code consumes the common chain interface.
