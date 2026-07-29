# Changelog

All notable changes to Holder Rewards will be documented here. The project follows semantic versioning once the first stable release is published.

## Unreleased

### Added

- Self-hosted Node deployment path (`apps/node`): the full application runs on any VPS with Node 22+ over a local SQLite database, sharing the worker's code, migrations, and features. Includes a D1-compatible database shim, automatic migrations at startup, a cron-driven scheduled job, and a VPS guide covering HTTPS with Caddy, systemd, updates, and backups.

## 0.3.0 - 2026-07-28

### Added

- Optional per-chain NFT indexers managed from the browser manager's advanced network settings: Alchemy-compatible NFT APIs unlock EVM trait rules on large or non-enumerable collections, and DAS-compatible endpoints (for example Helius) enable collection-wide Solana NFT rules.
- `solana-collection` holder rule type for owning a minimum number of NFTs from a verified Solana collection across linked wallets.
- Indexer health checks with one-click retry in the manager.
- Optional Cloudflare Queues offload for high-volume scheduled holder revalidation via a `ROLE_SYNC_QUEUE` binding; the default free-tier cron batching is unchanged.
- Member tipping via `/tip` with a manager-controlled daily tipping limit (default 100, `0` disables) as the anti-farming cap.
- Quest engine: managers create wallet-link, role-hold, daily-claim-streak, and secret-code quests in the browser manager; members complete them via `/quests` with one-time payouts enforced by a completion table.
- Point-priced raffles: `/raffle enter` buys capped entries, weighted-random draws in the manager, optional automatic prize roles, and full entry refunds on cancellation.
- Points store: `/store buy` purchases manager-listed items with optional limited stock and automatic Discord role grants; failed role grants roll back the charge completely, and a recent-purchases feed supports manual fulfillment.
- Custom proof quests: members paste proof (links or text) in a Discord popup, and managers approve (automatic payout) or reject from a review queue in the browser manager.
- Nested requirement groups: each holder role combines named Any/All rule groups under the role's own Any/All mode, covering logic such as `(NFT A OR NFT B) AND Token C`. Existing roles keep their behavior unchanged in a default Main group.
- Sales bot: per-collection watches post new EVM NFT sales (name, image, price, marketplace, buyer, seller, transaction link) to a manager-chosen Discord channel from the scheduled job, using the optional indexer configuration; failures are recorded per watch without affecting others.
- Demo Chain (testing) network for end-to-end deployment testing without real assets: manager-created rules on it qualify any member with a linked wallet.
- Queue offload status in the manager overview, showing whether the optional Cloudflare Queue is configured and when it last processed revalidations.

### Removed

- Removed the unfinished Docker/Postgres/Gateway development scaffold (`apps/bot`, `apps/web`, `packages/db`, `packages/core`, `packages/env`, `Dockerfile`, `docker-compose.yml`, `.env.docker.example`). The browser-only Cloudflare Worker + D1 deployment is the single supported path.

## 0.2.0 - 2026-07-23

### Changed

- Replaced the Cloudflare clone-based deploy button with a GitHub-template-first flow so operators can grant Cloudflare access to only their Holder Rewards repository.
- Standalone deployment now provisions D1 before applying migrations and securely promotes the Discord token from a Cloudflare build secret to an encrypted Worker runtime secret.

### Security

- Ordinary setup no longer asks the Cloudflare GitHub App for access to every existing and future repository.

## 0.1.1 - 2026-07-23

### Fixed

- Clean-checkout workspace lint and type resolution no longer depend on generated `dist` files.
- Worker tests build their internal runtime dependency instead of relying on stale local build output.
- Standalone release verification installs the Cloudflare package's own locked dependencies before checking it.

### Verified

- Public browser-only Cloudflare deployment routes to the standalone release directory.
- Clean dependency installation, workspace checks, tests, build, migrations, and one-click release smoke test.

## 0.1.0 - 2026-07-23

### Added

- One-click Cloudflare Worker and D1 deployment foundation.
- Automatic Discord endpoint and slash-command synchronization.
- EVM SIWE, EIP-1271, and Solana Ed25519 wallet ownership verification.
- EVM NFT/token/trait rules and exact Solana mint/SPL-token rules.
- Multi-wallet role synchronization, scheduled rechecks, points, branding, audit history, and CSV exports.
- Per-role Any/All requirement groups across EVM and Solana assets.
- Short-lived ownership-result caching with uncached manual refresh and scheduled cleanup.
- Embedded private-link QR handoff for mobile wallet browsers.
- Automatic EVM and Solana provider health checks in the manager with plain-language status and one-click retry.
- Automatic first-page launch readiness for app data, Discord setup, and enabled blockchain networks.
- Browser-only end-to-end testing guide for bot installation, wallet proof, holder roles, and rewards.
- Beginner Discord Developer Portal guide from application creation through scopes, permissions, deployment, installation, and role hierarchy.
- One operator entry point instead of separate bot-creation, deployment, and testing paths.

### Security

- One-time, expiring, domain-bound wallet challenges with bounded attempts.
- Safe role preservation when ownership providers fail.
- Manager permission checks and private, expiring management sessions.
