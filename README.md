# Holder Rewards

An open-source Discord holder-verification and rewards platform for NFT and token communities.

The project is designed so each community owns its deployment, Discord application, secrets, and data. There is no required Holder Rewards account and no subscription to this project.

## Product Promise

This project is built first for nontechnical community operators, not infrastructure specialists. The recommended experience must be deployable from a browser, require only unavoidable platform credentials, configure itself automatically, and remain usable on free or very low-cost hosting for a small community. Docker, terminals, manual migrations, endpoint copying, and developer-oriented configuration belong only to optional advanced paths.

An experienced developer can clone and reshape the repository, but advanced customization must never make ordinary self-hosting harder.

## Current Status

The hosted foundation is working. It currently provides:

- A Cloudflare Worker deployment target.
- A D1 database schema with automatic migrations.
- Signed Discord interaction verification.
- Discord `PING`, `/verify`, and `/rules` interaction handling.
- Automatic Discord endpoint configuration and versioned slash-command synchronization.
- An interactive verification panel that privately identifies the Discord member.
- Short-lived browser sessions whose secret tokens are stored only as hashes.
- EIP-4361 (SIWE) wallet linking for Ethereum, Base, Polygon, Arbitrum One, ApeChain, and custom EVM networks.
- Sign-In with Solana-style wallet linking through Wallet Standard and common injected wallets, verified with Ed25519.
- One-time signature challenges with domain, network, Discord member, server, and expiration binding.
- Multi-wallet browser discovery and an embedded QR/Share/Copy handoff into mobile wallet browsers, with no additional service account, project ID, or API key.
- Per-link challenge and signature-attempt limits before contract-wallet RPC checks.
- Manager-only `/rules` commands for EVM NFT/token requirements and exact Solana mint balances.
- A private browser manager launched by `/rules manage`, with Discord role and network dropdowns.
- Direct-metadata trait rules for enumerable ERC-721 collections, with bounded scans and a D1 cache.
- Optional per-chain NFT indexers for trait rules on large or non-enumerable EVM collections (Alchemy-compatible NFT APIs).
- Collection-wide Solana NFT rules through a replaceable DAS indexer endpoint such as Helius.
- Exact ERC-721 token-ID and ERC-1155 token-ID balance rules without an indexer.
- Additive multi-role synchronization across every linked EVM and Solana wallet, including safe role removal.
- Per-role Any/All requirement groups that can combine NFTs, traits, fungible tokens, and different chains.
- Private linked-wallet management with account-scoped unlinking and immediate role refresh.
- An append-only, per-server points ledger with browser-managed naming and currency images, daily claims, manager grants, balances, and a leaderboard.
- Member tipping with a manager-controlled daily cap, and quests that pay once per member for linking a wallet, holding a role, collecting daily rewards, or submitting a secret code.
- Point-priced raffles with weighted draws, automatic prize roles, and full refunds on cancellation, plus a points store with stock limits, automatic role grants, and safe rollback when Discord rejects a grant.
- Per-server community branding with a display name, logo, and accessible accent color.
- A manager overview for verified members, wallets, rules, rewards activity, scheduled checks, sync problems, and automatic blockchain-provider health checks with one-click retry.
- An automatic first-page launch check for app data, Discord setup, and every enabled blockchain network.
- A durable manager audit feed for wallet links, settings, images, holder rules, role changes, and reward transactions.
- Private one-click CSV exports for verified holders, reward balances, wallet links, and audit history.
- Per-server wallet privacy controls that shorten manager exports by default and require explicit opt-in for full addresses.
- Rolling scheduled holder revalidation with persistent per-server membership and failure records.
- Optional Cloudflare Queues offload for high-volume scheduled revalidation; the free-tier cron batching remains the default.
- Short-lived ownership-result caching that reduces public RPC calls while manual refresh remains authoritative.
- A working chain registry with Ethereum, Base, Polygon, Arbitrum One, ApeChain, Solana, and custom EVM networks.
- A protected optional API for adding future EVM-compatible chains without changing core logic.

EVM wallet linking supports EIP-6963 multi-wallet discovery, provider-neutral mobile wallet-browser handoff, browser-injected EOA wallets, and EIP-1271 contract signatures on configured networks. Solana linking supports Wallet Standard plus common injected wallets and verifies the exact challenge with Ed25519. Direct-RPC EVM holder roles, exact Solana mint/SPL-token balances, and per-role Any/All groups work without an indexer or additional provider key. Counterfactual smart accounts and nested rule groups remain under development.

## Deployment Choices

### Browser-Only Cloudflare

This is the recommended path for nontechnical operators. It does not require Docker, Node.js, a database installation, a domain, or a computer that remains online.

[Create your private Holder Rewards repository](https://github.com/Sheriff1980/holder-rewards-cloudflare/generate)

GitHub creates a fully populated private repository from the official template. The operator then grants Cloudflare access to only that repository. Cloudflare provisions D1, securely installs the bot token, runs migrations, and deploys the Worker.

The only required build secret is:

- `DISCORD_BOT_TOKEN`

Nontechnical operators should use only [Start Here](docs/START_HERE.md). There is no second operator installation guide.

See [SECURITY.md](SECURITY.md) for verification guarantees, operator responsibilities, and the current threat model.

The app securely discovers the application ID and interaction verification key from Discord. An optional `SETUP_TOKEN` can be added later to unlock advanced custom-EVM-network controls; ordinary setup does not need it.

After deployment, open the generated `workers.dev` URL. The app configures its Discord endpoint and synchronizes every slash command automatically. Select **Add bot to Discord**, choose the server, then use `/rules manage` in Discord to open the private holder-role manager.

See [chain support](docs/CHAINS.md) for built-in networks and the custom-chain format.
See [holder role rules](docs/RULES.md) for NFT/token rule setup and current limitations.
See [community points](docs/POINTS.md) for daily claims, balances, and ledger behavior.
See [customization](docs/CUSTOMIZATION.md) for community branding and image storage.
See [updates and recovery](docs/UPGRADES_AND_RECOVERY.md) for D1 migrations, backups, exports, and point-in-time restore.

The [Cloudflare release notes](docs/CLOUDFLARE.md) are for project developers maintaining the public deployment template. They are not operator setup instructions.

### Local Development

Requirements: Node.js 22+ and pnpm 9+.

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm exec wrangler d1 migrations apply DB --local
pnpm dev:cloudflare
```

Wrangler prints the local URL. The default is usually `http://localhost:8787`.

## Repository Layout

- `apps/worker`: recommended serverless Discord/web application.
- `migrations`: Cloudflare D1 migrations.
- `packages/chains`: replaceable wallet and ownership adapters.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Free-Hosting Goal

The core hosted edition is designed to operate within Cloudflare's free limits for small communities. Large communities, frequent full-holder scans, custom domains, or high-volume blockchain indexing may require paid infrastructure. The software itself remains free, and providers remain replaceable.

## Safety Principles

- Verification never requests token approvals or blockchain transactions.
- Discord HTTP interactions are rejected unless their Ed25519 signatures are valid.
- Wallet challenges will be readable, domain-bound, short-lived, and one-time use.
- Private browser-session tokens are sent in ephemeral Discord replies and stored only as SHA-256 hashes.
- A wallet already linked to one Discord account cannot be silently transferred to another.
- Secrets belong in Cloudflare secrets, environment variables, or a platform secret manager.
- Paid indexers are optional adapters, not required platform accounts.

## License

MIT. See [LICENSE](LICENSE).
