# Changelog

All notable changes to Holder Rewards will be documented here. The project follows semantic versioning once the first stable release is published.

## Unreleased

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
