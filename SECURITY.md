# Security

This project handles Discord identities, wallet ownership proofs, bot permissions, and reward balances.

## Verification Guarantees

- An EVM wallet is linked only after its signer returns a valid, readable SIWE signature. A Solana wallet is linked only after an Ed25519 signature verifies against its base58 public key and the exact human-readable challenge bytes.
- Challenges bind the site domain, Discord user, Discord server, network, wallet address, nonce, request ID, and expiration.
- Challenges are one-time use. Browser-session tokens are short-lived and stored only as SHA-256 hashes.
- EIP-1271 signatures are checked against bytecode on the configured chain. RPC chain IDs must match before contract calls are trusted.
- Verification never requests a token approval, asset transfer, or blockchain transaction.
- Each private link has bounded challenge and signature-check budgets before RPC work is performed.
- Cached ownership rows contain a one-way key plus the result and expire after 60 seconds; wallet addresses and Discord IDs are not stored in the cache table.

## Threat Model

### Wallet Phishing

An attacker may imitate the verification page or send a member a fake link. The real flow starts from a button in the community's Discord server, never from an unsolicited DM, and displays the exact SIWE statement before signing. Community operators should publish their deployed domain and teach moderators never to distribute alternate verification links.

### Replay and Link Theft

A copied private link can be used during its short lifetime, but it cannot authorize a wallet without that wallet's signature. Nonces, request IDs, domain binding, expiration, atomic challenge consumption, and per-link attempt limits prevent a captured signature from being reused or moved to another member, server, or deployment.

### Discord Account Compromise

Anyone controlling a member's Discord account can request a private link for that Discord identity. They still need a wallet signature to link assets. Communities should require Discord multi-factor authentication for managers and follow Discord's account-recovery guidance.

### Bot Token Leaks

The Discord bot token grants control of the installed bot. It must remain a deployment secret and must never be committed, logged, embedded in browser HTML, or shared with support. Rotate it immediately in Discord and redeploy if exposure is suspected.

### Manager Abuse

Discord members with server-management permission can change rules, rewards, and branding. The bot additionally respects Discord role hierarchy when presenting assignable roles and records manager changes in the audit history. Finer-grained manager permissions remain a roadmap item.

Manager exports require a short-lived private manager session and are returned with no-store caching. Wallet addresses are shortened by default; revealing full addresses requires an audited per-server opt-in. CSV values are escaped and formula-like values are neutralized before download.

### RPC and Metadata Poisoning

RPC endpoints and NFT metadata can return false or malicious data. Contract calls are pinned to the configured chain ID, metadata fetches are bounded, and metadata is treated as data rather than executable content. Operators adding custom networks are responsible for selecting trustworthy HTTPS RPC endpoints. Multi-provider consensus is not currently implemented.

### Reward Farming

Daily claims use an append-only ledger and one claim per Discord member, server, and UTC day. Sybil resistance is community-specific; operators should combine reward rules with holder requirements and Discord moderation. Transferable-wallet and multi-account collusion cannot be eliminated by the bot alone.

## Reporting Vulnerabilities

Do not open a public issue containing secrets, private links, or exploit details. Use the repository's private vulnerability-reporting feature when it becomes available, or contact the repository owner privately. Add a project contact address before the first public release.
