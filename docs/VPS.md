# VPS / Self-Hosted Node Deployment

This is the advanced self-hosting path for operators who want to run Holder Rewards on their own server (a Hostinger VPS, a home server, or any Linux box) instead of Cloudflare. The recommended path for most communities remains the [browser-only Cloudflare deployment](../README.md#browser-only-cloudflare) — it is free and needs no server maintenance. Choose this path only if you are comfortable running a Node.js service.

The Node host runs the same application code as the Cloudflare Worker: same features, same migrations, same manager UI. Data lives in a SQLite file on your server instead of Cloudflare D1.

## What You Need

- A Linux server with **Node.js 22 or newer** and **pnpm 9 or newer** (`npm install -g pnpm`).
- A Discord application bot token.
- A public domain or subdomain pointing at the server (Discord requires HTTPS for the interaction endpoint).

## Install And Run

```bash
git clone https://github.com/Sheriff1980/holder-rewards.git
cd holder-rewards
pnpm install
pnpm --filter @holder-rewards/node build

cd apps/node
cp .env.example .env   # then edit .env and paste your Discord bot token
pnpm start
```

The server listens on `http://localhost:8787` by default, applies all database migrations automatically on first boot, and stores data in `apps/node/data/`.

`.env` options:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DISCORD_BOT_TOKEN` | yes | — | Bot token from the Discord Developer Portal. |
| `PORT` | no | `8787` | Local port to listen on. |
| `DATA_DIR` | no | `./data` | Where the SQLite database lives. |
| `APP_NAME` | no | `Holder Rewards` | Display name used in Discord messages. |
| `REWARD_CURRENCY_NAME` | no | `Points` | Default points currency name. |
| `DAILY_CLAIM_AMOUNT` | no | `10` | Default daily claim. |
| `SETUP_TOKEN` | no | — | Optional; unlocks the protected custom-chain API. |

## Put HTTPS In Front (Caddy)

Discord only accepts HTTPS interaction endpoints. The simplest reverse proxy is [Caddy](https://caddyserver.com), which handles certificates automatically:

```text
# /etc/caddy/Caddyfile
bot.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

`sudo systemctl reload caddy`, then open `https://bot.example.com` — the app's launch check finishes Discord setup (endpoint and commands) automatically. The Node host reads `X-Forwarded-Proto`, which Caddy sends, so generated links use `https://` correctly.

Running several bots on one VPS? Give each its own port and subdomain (`holder.example.com` → 8787, `cards.example.com` → 3000, …) in the same Caddyfile.

## Keep It Running (systemd)

```ini
# /etc/systemd/system/holder-rewards.service
[Unit]
Description=Holder Rewards Discord bot
After=network-online.target

[Service]
WorkingDirectory=/opt/holder-rewards/apps/node
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now holder-rewards
```

## Updates

```bash
cd holder-rewards
git pull
pnpm install
pnpm --filter @holder-rewards/node build
sudo systemctl restart holder-rewards
```

New database migrations apply automatically on startup. Configuration, linked wallets, points, and all community data are preserved in the SQLite file.

## Backups

Everything that matters is in `apps/node/data/`. Back it up nightly with any of:

- `sqlite3 data/holder-rewards.db ".backup '/backups/holder-rewards-$(date +%F).db'"` (safe while running),
- or simply copy the `data/` directory while the service is stopped,
- or ship the directory to object storage with your existing backup tooling.

## Differences From The Cloudflare Path

- The optional Cloudflare Queues offload does not apply; scheduled revalidation runs inline in the same process (the workload fits comfortably for small to medium communities).
- Everything else — wallet verification, holder rules, nested groups, points, quests, raffles, store, sales bot, demo chain — behaves identically.
