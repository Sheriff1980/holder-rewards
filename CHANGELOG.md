# Changelog

All notable changes to Holder Rewards will be documented here. The project follows semantic versioning once the first stable release is published.

## Unreleased

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
