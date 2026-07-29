# Host On An Ubuntu VPS

This advanced path runs Holder Rewards on an Ubuntu VPS. The browser-only Cloudflare path in `docs/START_HERE.md` remains the recommended choice for nontechnical operators.

These instructions use:

- Ubuntu 24.04
- Node.js 22
- A local SQLite database
- Caddy for automatic HTTPS
- systemd to keep the app running

You need a VPS, a domain or subdomain, its Discord bot token, and the VPS login information supplied by the hosting company.

## 1. Point A Web Address At The VPS

In the company that manages your domain's DNS:

1. Add an `A` record.
2. Use a name such as `rewards`.
3. Enter the public IPv4 address of the VPS.
4. Save it.

The finished address will resemble `rewards.example.com`. DNS changes can take several minutes to become available.

## 2. Connect To The VPS

On Windows, open PowerShell and enter the command supplied by the VPS company. It usually resembles:

```powershell
ssh root@203.0.113.10
```

Accept the fingerprint if prompted, then enter the VPS password. The remaining commands in this guide go into that VPS window.

## 3. Install Node.js, Git, And Caddy

```bash
apt update
apt install -y ca-certificates curl gnupg git sudo ufw
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt update
apt install -y nodejs
npm install --global pnpm@9.15.4
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

Confirm the installations:

```bash
node --version
pnpm --version
caddy version
```

Node must report version 22 or newer.

## 4. Create A Private Service Account

```bash
useradd --system --create-home --home-dir /opt/holder-rewards --shell /usr/sbin/nologin holder-rewards
```

The application will run as this restricted account instead of as `root`.

## 5. Download And Build Holder Rewards

```bash
git clone https://github.com/Sheriff1980/holder-rewards.git /opt/holder-rewards/app
chown -R holder-rewards:holder-rewards /opt/holder-rewards
cd /opt/holder-rewards/app
sudo -u holder-rewards pnpm install
sudo -u holder-rewards pnpm --filter @holder-rewards/node build
```

## 6. Add The App Settings

```bash
cd /opt/holder-rewards/app/apps/node
sudo -u holder-rewards cp .env.example .env
nano .env
```

Set these two lines:

```text
DISCORD_BOT_TOKEN=paste-your-real-token-here
PUBLIC_APP_URL=https://rewards.example.com
```

Replace the example address with the DNS name created in Step 1. In `nano`, press `Ctrl+O`, Enter, then `Ctrl+X` to save and close.

Protect the token:

```bash
chown holder-rewards:holder-rewards .env
chmod 600 .env
```

## 7. Keep The App Running

Create the service:

```bash
nano /etc/systemd/system/holder-rewards.service
```

Paste:

```ini
[Unit]
Description=Holder Rewards Discord bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=holder-rewards
Group=holder-rewards
WorkingDirectory=/opt/holder-rewards/app/apps/node
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Save and close, then start it:

```bash
systemctl daemon-reload
systemctl enable --now holder-rewards
systemctl status holder-rewards --no-pager
```

The status should say `active (running)`.

## 8. Add HTTPS

Open the Caddy configuration:

```bash
nano /etc/caddy/Caddyfile
```

Replace its contents with:

```text
rewards.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Replace the example address with your real address. Save and close, then run:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Caddy obtains and renews the HTTPS certificate automatically.

## 9. Finish Setup

Open the permanent HTTPS address in a browser. The launch check should become green and provide the **Add bot to Discord** button.

Continue `docs/START_HERE.md` at **Step 9: Add The Bot To Your Server**.

## Updates

```bash
systemctl stop holder-rewards
cd /opt/holder-rewards/app
sudo -u holder-rewards git pull
sudo -u holder-rewards pnpm install
sudo -u holder-rewards pnpm --filter @holder-rewards/node build
systemctl start holder-rewards
```

Database migrations apply automatically and preserve community data.

## Backups

The database and uploaded images are in:

```text
/opt/holder-rewards/app/apps/node/data
```

For a simple stopped-service backup:

```bash
systemctl stop holder-rewards
tar -czf /root/holder-rewards-backup-$(date +%F).tar.gz -C /opt/holder-rewards/app/apps/node data
systemctl start holder-rewards
```

Copy the resulting archive off the VPS. A backup stored only on the same VPS does not protect against the VPS being deleted.

## Troubleshooting

Check the app:

```bash
systemctl status holder-rewards --no-pager
journalctl -u holder-rewards -n 100 --no-pager
```

Check HTTPS:

```bash
systemctl status caddy --no-pager
journalctl -u caddy -n 100 --no-pager
```

Do not paste the `.env` file, Discord token, or tunnel credentials into a support message.

## Differences From Cloudflare

- Scheduled holder checks run inside the Node service instead of Cloudflare Cron and Queues.
- Data is stored in the VPS SQLite file instead of Cloudflare D1.
- The VPS owner is responsible for operating-system updates, uptime, and off-server backups.
- Wallet verification, holder rules, points, quests, raffles, store, sales bot, and manager features use the same application code.
