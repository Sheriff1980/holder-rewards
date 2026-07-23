# Open Source Drip-Style Discord Holder Verification and Rewards TODO

## Product North Star

The primary customer is a nontechnical Discord community operator who wants an inexpensive self-hosted rewards and token bot with very little fuss. The default path must work from a browser without Git, Docker, Node.js, a terminal, manual migrations, command-registration steps, or copied callback URLs. Only ask users for credentials and approvals that Discord, Cloudflare, or a chain provider genuinely requires; automate the rest.

Advanced users can clone the repository and make sweeping changes. They are not the audience that should determine the default setup experience.

Every feature must pass this operability check before it is complete:

- Browser-only deployment remains possible.
- All technically automatable setup and upgrades are automatic.
- Ordinary controls use plain language and advanced controls stay out of the main path.
- Small communities can use sensible free or low-cost defaults.
- Failures recover automatically or through one simple on-screen action.

## Research Notes

Drip's public listings describe a Discord-centered community economy for web3 projects: branded points/currencies, Discord engagement rewards, quests, tipping, raffles/store spending, NFT/token holder rewards, "instant soft staking", NFT multipliers, sales bot posts, meme generation, onboarding, permission controls, exports/reports, and a developer API.

Comparable products split the problem into two major surfaces:

- Holder verification: users prove wallet ownership, the app checks NFT/token holdings, and Discord roles are assigned or removed as holdings change.
- Rewards economy: verified members earn points from ownership, claims, quests, purchases, games, tips, raffles, and store redemptions.

The safest clone should start with verification and role sync, then add points and rewards. Wallet verification should avoid asking users to sign vague messages. Use standard sign-in flows, one-time nonces, domain-bound messages, short expirations, and clear copy. For Ethereum/EVM use SIWE/EIP-4361. For Solana use Sign-In with Solana or wallet-standard message signing with equivalent nonce/domain protections.

## Product Scope

### Core Principle

This should be a self-hostable, open-source alternative to paid third-party Discord verification/rewards platforms. A normal project owner should click a hosted deploy button, provide only required platform credentials, open the generated app, and add the bot to Discord. Cloning the repository, editing environment files, and running setup commands are optional advanced developer paths, not the product's default experience.

### MVP

- Discord bot install flow with `bot` and `applications.commands` scopes.
- Admin slash commands to configure projects, verification panels, chains, collections/tokens, thresholds, traits, and role mappings.
- Verification panel embed with a button.
- Web verification flow that links Discord user ID to one or more wallets.
- Wallet signature verification with nonce replay protection.
- NFT/token ownership lookup.
- Role assignment and removal based on configured rules.
- Scheduled recheck job for ownership changes.
- [x] Private browser manager for configuration, branding, rules, rewards, and operational status.
- [x] Complete audit history for wallet links, settings, images, holder rules, role changes, reward transactions, and failed checks.

### V1 Rewards

- Points ledger with immutable transactions.
- Daily holder claim.
- Soft staking accrual based on NFTs/tokens held.
- Configurable NFT/token multipliers.
- Manual admin grant/revoke commands.
- Leaderboard.
- Member balance command.
- Export CSV for balances and holder snapshots.

### V1.5 Community Features

- Quest engine for Discord actions.
- Twitter/X or social quests only after API feasibility is confirmed.
- Store/redemption system.
- Raffles.
- Tipping.
- Sales bot posts for configured collections.
- Trait-based roles.
- Multi-currency support.

## Architecture TODO

- [x] Choose initial chain support: EVM and Solana, including ApeChain.
- [x] Pick stack: TypeScript is the likely default for Discord.js, web app, wallet libraries, and indexer SDKs.
- [x] Create repo structure:
  - [x] `apps/worker` for the recommended Cloudflare-hosted application.
  - [x] `apps/bot` for Discord interactions and role sync.
  - [x] `apps/web` for OAuth/wallet verification/admin dashboard.
  - [x] `packages/db` for schema and migrations.
  - [x] `packages/chains` for ownership adapters.
  - [x] `packages/core` for rewards and rule evaluation.
- [x] Choose databases: D1 for one-click hosting; Postgres for advanced deployments.
- [x] Choose the initial hosted scheduler: Cloudflare Cron Triggers.
- [ ] Add Cloudflare Queues when ownership sync jobs are implemented.
- [x] Define a chain adapter interface:
  - [x] `verifySignature`
  - [x] `getNftHoldings`
  - [x] `getTokenBalance`
  - [ ] `getCollectionTraits`
  - [ ] `subscribeOrPollTransfers`
- [ ] Decide indexer providers:
  - [ ] Solana: Helius, SimpleHash, Magic Eden, Metaplex DAS/RPC.
  - [ ] EVM: Alchemy, Reservoir, SimpleHash, Moralis, direct RPC fallback.
- [x] Add provider abstraction so self-hosters can swap vendors.
- [x] Add an extensible chain registry with built-in and custom network definitions.
- [x] Add ApeChain mainnet as an EVM network with chain ID `33139`.
- [ ] Complete the shared EVM adapter for Ethereum, Base, Polygon, Arbitrum, and ApeChain:
  - [x] Direct-RPC ERC-721 `balanceOf` checks.
  - [x] Direct-RPC ERC-20 balance and decimals checks.
  - [x] ERC-1155 token-ID balances.
  - [ ] NFT enumeration and metadata.
  - [x] Bounded ERC-721 Enumerable ownership and `tokenURI` metadata fallback.
  - [ ] Indexer-backed enumeration for non-enumerable and large collections.
- [ ] Complete the Solana adapter:
  - [x] Wallet Standard/injected-wallet discovery and Ed25519 message verification.
  - [x] Direct-RPC SPL-token and exact NFT-mint balances across linked wallets.
  - [ ] Collection-wide NFT ownership and metadata through a replaceable DAS/indexer adapter.

## Discord TODO

- [x] Automatically register and version slash command definitions.
- [x] Complete the slash command catalog for the hosted release:
  - [x] Automatic browser launch setup replaces `/verify setup`.
  - [x] `/verify panel`
  - [x] `/verify status`
  - [x] `/verify refresh`
  - [x] `/rules add-nft`
  - [x] `/rules manage` private browser manager
  - [x] `/rules add-token`
  - [x] `/rules add-trait`
  - [x] `/rules add-nft-id`
  - [x] `/rules add-erc1155`
  - [x] `/rules list`
  - [x] `/rules remove`
  - [x] `/points claim`
  - [x] `/points balance`
  - [x] `/points grant` with manager permission and audit metadata
  - [x] `/points leaderboard`
- [x] Implement an interactive verification panel button with an ephemeral private link.
- [x] Request only required bot permissions:
  - [x] Manage Roles
  - [x] View Channels
  - [x] Send Messages
  - [x] Use Slash Commands
- [x] Validate Discord HTTP interaction signatures.
- [x] Restrict verification-panel posting to server managers.
- [x] Detect role update failures and direct admins to bot role hierarchy/RPC settings.
- [x] Add guild-specific config and permissions.
- [x] Add bounded rate-limit and transient-error retries for Discord member and role APIs.
- [x] Reject stale and replayed Discord interactions before side effects.
- [x] Add idempotent role sync so retries do not duplicate work.

## Verification TODO

- [x] Bind the browser flow to a Discord member through a component interaction, without requiring Discord OAuth or a client secret.
- [x] Generate one-time nonce per verification attempt.
- [x] Store nonce with expiration and intended Discord user/guild.
- [x] Implement EVM SIWE verification for externally owned accounts.
- [x] Add EIP-1271 smart-contract wallet signature verification through configured RPC providers.
- [x] Add a provider-neutral mobile-wallet handoff without requiring another operator account or API key.
- [x] Add an embedded QR handoff for opening the private verification session on a phone without a third-party project ID or QR service.
- [x] Implement human-readable, domain-bound Solana sign-in/message verification with Ed25519 signatures.
- [x] Prevent replay across guilds, domains, users, and expired sessions.
- [x] Limit challenge creation and signature checks per short-lived private link before RPC verification.
- [x] Support multiple EVM and Solana wallets per Discord user.
- [x] Allow wallet unlinking from the private verification page and refresh roles immediately.
- [x] Add privacy controls for whether admins can export full wallet addresses, with shortened addresses by default.
- [x] Add suspicious flow warnings: no DMs, no token approvals, no transaction signing.

## Ownership and Rules TODO

- [x] Model rule types:
  - [x] NFT collection minimum count.
  - [x] Fungible token minimum balance.
  - [x] Trait-based NFT ownership.
  - [x] Exact ERC-721 token ID and ERC-1155 token ID ownership.
  - [x] Exact Solana NFT mint and SPL-token minimum balances.
  - [x] Per-role any-of and all-of requirement groups across EVM and Solana rules.
- [x] Implement rule evaluator.
- [x] Cache successful ownership results for 60 seconds using chain/rule/wallet-bound keys; manual refresh bypasses the cache.
- [x] Add manual refresh command with deferred Discord responses.
- [x] Cache direct NFT metadata traits in D1 with a 24-hour TTL.
- [x] Add cursor-based scheduled revalidation for small Cloudflare deployments.
- [ ] Move high-volume scheduled revalidation to Cloudflare Queues or a replaceable job runner.
- [x] Remove roles when all successfully evaluated rules for that role no longer qualify.
- [x] Add bounded one-click CSV exports for holders, balances, wallet links, and audit history.

## Rewards TODO

- [x] Design points ledger schema with append-only transactions.
- [ ] Add reward source types:
  - [x] Daily claim.
  - [ ] Holder accrual.
  - [x] Admin grant with manager identity and optional reason metadata.
  - [ ] Quest completion.
  - [ ] Purchase/sale bonus.
  - [ ] Tip.
  - [ ] Raffle/store spend.
- [x] Implement duplicate-safe, holder-qualified daily claim cooldowns using UTC days.
- [ ] Implement soft-staking accrual calculation.
- [ ] Implement NFT multiplier rules.
- [ ] Add anti-abuse limits for claims, tips, and quest rewards.
- [ ] Add balance recalculation/audit command.

## Security TODO

- [x] Threat model wallet phishing, signature replay, Discord account compromise, bot token leaks, admin abuse, API poisoning, and reward farming.
- [x] Never request token approvals or transactions for verification.
- [x] Make EVM signed messages human-readable.
- [x] Bind EVM signed messages to domain, URI, chain ID, nonce, issued-at, expiration, Discord user, and guild.
- [x] Keep the bot token in Cloudflare's encrypted secret store and store browser-session tokens only as SHA-256 hashes.
- [x] Store wallet addresses as public identifiers but treat Discord linkage as personal data.
- [x] Add admin action audit logs beyond the existing role-sync event log.
- [x] Add per-guild permissions and least-privilege command defaults.
- [x] Document D1 Time Travel, offline exports, restore safety, and migration recovery.

## Open Source TODO

- [x] Pick license: MIT.
- [x] Add the full license text in `LICENSE`.
- [x] Write `README.md` with what this project is and is not.
- [x] Add `.env.docker.example` for the advanced Docker path without polluting one-click Worker secrets.
- [x] Add initial `README.md` with what this project is and is not.
- [x] Declare required Cloudflare secrets and validate Node environment variables at startup.
- [x] Add initial runtime startup checks that explain missing/invalid environment variables in plain English.
- [x] Add Docker Compose for Postgres, Redis if used, bot, and web.
- [x] Add a hosted deploy command that applies D1 migrations before deployment.
- [ ] Add a non-developer local installer.
- [x] Add contribution guide.
- [x] Add initial security policy.
- [ ] Add a responsible disclosure address or enable GitHub private vulnerability reporting.
- [ ] Add provider setup docs for Helius/Alchemy/etc.
- [x] Add one complete browser-only self-hosting and first-test guide.
- [x] Include a clean Discord test-server walkthrough in the same guide.
- [x] Add an exact beginner Discord application and bot creation guide covering names, token security, scopes, permissions, intents, installation, and role hierarchy.
- [ ] Add screenshots or a short setup video/GIF for non-developer server owners.
- [x] Add issue templates for bugs, chain provider support, and feature requests.
- [x] Add release notes/changelog.
- [ ] Publish versioned Docker images for easier deployment.
- [ ] Complete the optional Node/Docker deployment before advertising it as production-ready.

## Turnkey Self-Hosting TODO

- [ ] Design for "bring your own keys":
  - [x] Discord bot token.
  - [x] Discord application ID and public key discovered automatically from the bot token.
  - [x] Public app URL supplied by the deployment platform.
  - [x] D1 provisioned automatically or a user-owned Postgres database URL.
  - [ ] Redis/queue URL if used.
  - [ ] Chain/indexer provider keys.
  - [x] Advanced custom EVM networks are managed through the private Discord manager; no extra setup secret is required.
- [x] Keep secrets only in environment variables or secret managers.
- [x] Add one-click-host configuration with automatic D1 provisioning and migrations.
- [ ] Add the live Deploy to Cloudflare button after the permanent GitHub URL exists.
- [x] Provide `.env.docker.example` with every advanced Docker variable documented.
- [x] Provide `.dev.vars.example` for local Cloudflare development.
- [x] Provide `docker-compose.yml` for local and small production deployments.
- [ ] Provide production deployment examples:
  - [x] Cloudflare Workers + D1.
  - [ ] VPS/Docker.
  - [ ] Railway/Fly.io/Render-style app hosts.
  - [ ] Vercel or similar for web frontend if compatible.
- [x] Add automatic browser launch setup:
  - [x] Validate Discord credentials by registering commands.
  - [x] Validate every enabled keyless provider with a live health check.
  - [x] Create the guild and short-lived manager session automatically from Discord.
  - [x] Register Discord slash commands.
  - [x] Configure the Discord Interaction Endpoint URL automatically.
  - [x] Resynchronize changed command definitions from the scheduled job.
  - [x] Show the Discord bot invite button.
- [ ] Add seed/demo config for a sample collection.
- [x] Add Worker/web and database health checks with correct failure status.
- [x] Add a browser launch check for database, Discord automation, and every enabled network.
- [x] Add automatic EVM and Solana provider health checks with one-click retry.
- [ ] Add bot and queue health checks when queue infrastructure is introduced.
- [x] Add backup/restore docs for database and config.
- [x] Add migration docs for updates between versions.
- [x] Let each server configure its display name, logo, accent color, currency label, currency image, and daily reward from the browser manager.
- [x] Add a browser-only end-to-end community testing checklist.
- [x] Add a clean standalone-release smoke test covering install, every migration, boot, health, setup rendering, and chain registry.
- [x] Add a manager-only advanced form for future EVM-compatible chains.
- [ ] Make all paid API providers replaceable with adapters or direct RPC fallbacks where possible.
- [x] Clearly mark that the shipped feature set requires no paid chain provider and that high-volume/indexer features are optional future work.

## Suggested Build Order

1. Build Discord bot skeleton and `/verify panel`.
2. Build the Discord-bound web session + wallet signature linking.
3. Add one chain adapter and one collection rule.
4. Assign/remove Discord roles from verification results.
5. Add scheduled ownership refresh.
6. Add admin rule management. (Browser rule CRUD, diagnostics, and recent role/reward activity complete.)
7. Add points ledger and daily claim.
8. Add soft staking and multipliers.
9. Add exports, audit logs, docs, and Docker setup.
10. Add quests/store/raffles/sales bot after the core is stable.
11. Package a v1 self-hosted release with Docker images, setup guide, and migration docs.
