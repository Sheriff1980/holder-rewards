# Chain Support

Holder Rewards separates a chain's identity from the adapter that knows how to communicate with its family. Adding another EVM network does not require another wallet-signature implementation; it uses the EVM adapter with a different numeric chain ID and RPC endpoint.

## Built-In Networks

| ID | Family | Network reference | Native currency | Default RPC |
| --- | --- | ---: | --- | --- |
| `ethereum` | EVM | `1` | ETH | `https://cloudflare-eth.com/v1/mainnet` |
| `base` | EVM | `8453` | ETH | `https://mainnet.base.org` |
| `polygon` | EVM | `137` | POL | `https://polygon.drpc.org` |
| `arbitrum` | EVM | `42161` | ETH | `https://arb1.arbitrum.io/rpc` |
| `apechain` | EVM | `33139` | APE | `https://apechain.calderachain.xyz/http` |
| `solana` | Solana | `mainnet-beta` | SOL | `https://rpc.solanatracker.io/public` |

The defaults are public endpoints intended for setup and light community traffic. Public RPC endpoints may be rate-limited; a failed ownership check leaves existing roles unchanged. Exact Solana mint/SPL-token checks use a keyless public RPC without another account or key. The manager automatically checks every enabled provider and offers a one-click retry when a network is unavailable.

Built-in provider overrides are not part of the first release. A manager can add another EVM-compatible network with its own public RPC under **Advanced network settings**. Provider URLs containing private API keys should not be stored there.

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

RPC URLs stored in the registry are configuration, not encrypted secrets. Do not place provider API keys, usernames, or passwords in these URLs. Provider credentials will use deployment secrets and adapter-specific configuration.

## Adding a New Family

New EVM-compatible networks can use the current adapter. Solana already implements signature verification and exact mint balances. Collection-wide Solana NFTs and genuinely different chain families still require adapters implementing:

- Wallet signature verification.
- NFT ownership lookup.
- Fungible-token balance lookup.
- Address normalization and validation.
- Provider health checks and rate-limit handling.

The rest of the verification, Discord, role-rule, and rewards code consumes the common chain interface.
