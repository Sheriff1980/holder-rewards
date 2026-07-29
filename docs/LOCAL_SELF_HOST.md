# Self-Host On A Windows Computer

This path runs Holder Rewards on your own Windows computer. The computer must remain powered on and connected to the internet whenever members use the bot. For most communities, the browser-only Cloudflare path in `docs/START_HERE.md` is simpler and more reliable.

This guide uses a Cloudflare Tunnel so you do not need to open ports on your router or reveal your home IP address. You need a domain already connected to your Cloudflare account.

## 1. Install The Required Programs

Install these three programs:

1. Download the **LTS** Windows installer from `https://nodejs.org/en/download`.
2. Run it and keep the default choices. Confirm the version is **22 or newer**.
3. Download Git for Windows from `https://git-scm.com/download/win`.
4. Run it and keep the default choices.
5. Open **Windows PowerShell** from the Start menu.
6. Enter:

```powershell
npm install --global pnpm@9.15.4
```

## 2. Download And Build Holder Rewards

Choose a permanent folder for the app. Do not put it in Downloads or a temporary folder.

```powershell
cd C:\
git clone https://github.com/Sheriff1980/holder-rewards.git
cd holder-rewards
pnpm install
pnpm --filter @holder-rewards/node build
```

Leave this PowerShell window open for now.

## 3. Create The Permanent Web Address

1. Sign in at `https://dash.cloudflare.com`.
2. Open **Zero Trust**.
3. Open **Networks**, then **Tunnels**.
4. Select **Create a tunnel**.
5. Choose **Cloudflared** and name it `holder-rewards`.
6. Choose **Windows**.
7. Cloudflare shows a PowerShell installation command containing a private tunnel token. Copy and run that exact command in PowerShell as an administrator.
8. Return to Cloudflare and select **Next**.
9. Under **Public Hostname**, choose a subdomain such as `rewards`.
10. Choose your domain. The finished address will look like `https://rewards.example.com`.
11. Set **Service type** to `HTTP`.
12. Set **URL** to `localhost:8787`.
13. Save the tunnel.

Do not share the tunnel installation command or its token.

## 4. Add The App Settings

In File Explorer, open:

```text
C:\holder-rewards\apps\node
```

1. Make a copy of `.env.example`.
2. Rename the copy to `.env`.
3. If Windows warns about changing the extension, select **Yes**.
4. Open `.env` in Notepad.
5. Paste the Discord bot token after `DISCORD_BOT_TOKEN=`.
6. Replace the example address after `PUBLIC_APP_URL=` with the permanent HTTPS address created in Step 3.
7. Save and close Notepad.

The two required lines should resemble:

```text
DISCORD_BOT_TOKEN=paste-your-real-token-here
PUBLIC_APP_URL=https://rewards.example.com
```

## 5. Start And Test The App

In PowerShell:

```powershell
cd C:\holder-rewards\apps\node
pnpm start
```

Open your permanent HTTPS address in a browser. The launch check should become green and provide the **Add bot to Discord** button. Finish the Discord steps in `docs/START_HERE.md`, beginning at **Step 9: Add The Bot To Your Server**.

Keep PowerShell open during this first test. Press `Ctrl+C` to stop the app.

## 6. Start It Automatically With Windows

1. Open **Task Scheduler** from the Start menu.
2. Select **Create Task**.
3. Name it `Holder Rewards`.
4. Select **Run whether user is logged on or not**.
5. Open **Triggers**, select **New**, and choose **At startup**.
6. Open **Actions**, select **New**, and choose **Start a program**.
7. For **Program/script**, enter:

```text
C:\Program Files\nodejs\node.exe
```

8. For **Add arguments**, enter:

```text
dist\server.js
```

9. For **Start in**, enter:

```text
C:\holder-rewards\apps\node
```

10. Under **Settings**, enable **If the task fails, restart every 1 minute**.
11. Save the task and enter your Windows password if requested.
12. Right-click the new task and select **Run**.
13. Open the public HTTPS address again and confirm the launch check is green.

## Updates

Stop the **Holder Rewards** task, then run:

```powershell
cd C:\holder-rewards
git pull
pnpm install
pnpm --filter @holder-rewards/node build
```

Start the task again. Database updates apply automatically.

## Backups

Back up this folder:

```text
C:\holder-rewards\apps\node\data
```

Stop the **Holder Rewards** task before copying it. The `.env` file contains the Discord token and must be kept private.
