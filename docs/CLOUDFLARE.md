# Developer Cloudflare Release Notes

This is an internal developer checklist. Nontechnical operators should not use this file for installation. The only operator setup path is [Start Here](START_HERE.md).

Cloudflare Workers is the recommended hosted target. Every community receives its own Worker, D1 database, Discord application, secrets, and `workers.dev` address.

## What Is Automated

The repository already declares:

- The Worker entry point in `wrangler.jsonc`.
- A D1 binding named `DB`.
- The required Discord bot-token secret.
- Rolling scheduled role revalidation.
- D1 migrations in `migrations/`.
- A deployment command that applies migrations before deploying.

Cloudflare's Deploy button can provision the declared D1 database and prompt for the required secrets when the repository is public.

## Discord Values

The operator creates the bot using [Start Here](START_HERE.md).

The only value copied into Cloudflare is the bot token, stored as `DISCORD_BOT_TOKEN`.

The Worker uses that token to discover the application ID and public verification key directly from Discord. No other value is required for ordinary setup.

Advanced operators may optionally add a separate long random `SETUP_TOKEN` secret later. It unlocks custom-EVM-network settings and must never reuse the Discord bot token.

## After Deployment

1. Open the generated `https://<worker-name>.<account>.workers.dev` address.
2. Wait for **Discord is connected and up to date**. The Worker configures the Interaction Endpoint URL and synchronizes the current command version automatically.
3. Select **Add bot to Discord** and choose the server.
4. In Discord, use `/rules manage` to open the private holder-role manager.

The setup page runs a **Launch check** automatically. It checks app data, Discord command and endpoint setup, and every enabled blockchain network. A local preview correctly shows Discord as waiting because Discord requires a public HTTPS endpoint. After deployment, all checks should be green before adding the bot.

The manager's **Overview** shows verified members, linked wallets, active rules, reward entries, the last scheduled check, current sync problems, automatic blockchain-network health, and recent role/reward activity. Network checks run when the manager opens and can be retried with one click. Existing roles remain unchanged when a provider check fails.

Future deployments compare a command fingerprint during the rolling scheduled job. New or changed commands are synchronized without asking the operator to revisit setup.

## Local Development

Copy `.dev.vars.example` to `.dev.vars` and replace every placeholder. Never commit `.dev.vars`.

```bash
pnpm install
pnpm exec wrangler d1 migrations apply DB --local
pnpm dev:cloudflare
```

Run tests and a deployment bundle check with:

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Publishing Checklist

- Replace the placeholder repository URL in the README with the permanent public GitHub URL.
- Add the official Deploy to Cloudflare button.
- Enable GitHub private vulnerability reporting.
- Configure release builds and dependency updates.
- Test a clean deployment in a new Cloudflare account.
- Test every screen in the local Discord bot guide before each release.

## Current Limitations

- Embedded QR and provider-neutral mobile wallet-browser handoff, EIP-1271 smart-contract wallets, and Solana signatures are working without another required service account.
- Collection-wide Solana NFT rules need a replaceable DAS/indexer adapter; exact NFT mint and SPL-token rules work through the public RPC fallback.
- Non-enumerable NFT trait checks need a replaceable indexer adapter.
- High-volume communities need a queue/job-runner deployment instead of the conservative free rolling scheduler.
- Message and reaction rewards require the optional persistent Gateway worker.
