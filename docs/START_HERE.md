# Start Here

This is the complete setup and first-test guide. Follow it from top to bottom in a browser. You do not need Git, Docker, Node.js, a terminal, a server, or a domain.

## Before You Begin

Have these ready:

- A Discord account that has **Manage Server** permission in the server you will test.
- A free GitHub account. You will use it to create your own private copy of the complete app before connecting Cloudflare.
- A free Cloudflare account.
- One NFT or token contract you can test and a wallet that owns the required asset.
- A private place, such as a password manager, to hold the Discord bot token briefly.

The bot token is the bot's password. Never post it in Discord, send it in a message, put it in a screenshot, or save it in a public file.

## 1. Create The Discord Application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Sign in with the Discord account that manages your community.
3. Select **New Application** in the upper-right corner.
4. Enter your community name followed by `Rewards`.
   Example: `Moon Club Rewards`.
5. Accept Discord's Developer Terms of Service and Developer Policy when shown.
6. Select **Create**.

## 2. Add The Name And Image Members Will See

You should now be on **General Information**.

1. Confirm the application name is recognizable.
2. Upload your community logo under **App Icon** if desired.
3. Add a short description, such as `Official holder verification and rewards bot for Moon Club`.
4. Leave **Interactions Endpoint URL** empty. Holder Rewards fills it in after deployment.
5. Do not copy the Application ID, Public Key, Client Secret, or any callback URL. Holder Rewards does not ask you for them.

You should get a prompt at the bottom of the page to save. Do it. Discord may prevent you from opening **Bot** while changes are unsaved.

## 3. Add The Bot Banner And Username

1. Select **Bot** in the left sidebar.
2. A bot user should already exist.
3. Discord offers an optional `640 x 240` banner before **Username**. Upload one only if you want to.
4. Under **Username**, use the same recognizable name if Discord did not copy it.
5. Leave **Requires OAuth2 Code Grant** off.
6. Leave **Public Bot** on for the moment.
7. Under **Privileged Gateway Intents**, leave **Presence Intent**, **Server Members Intent**, and **Message Content Intent** off.
8. Use the save prompt at the bottom if you changed the banner or username.

## 4. Choose Where The Bot Can Be Installed

1. Select **Installation** in the left sidebar.
2. Under **Installation Contexts**, turn **Guild Install** on.
3. Turn **User Install** off.
4. Under **Install Link**, select **None**.
5. Use the save prompt at the bottom.

## 5. Make The Bot Private And Copy Its Token

1. Return to **Bot** in the left sidebar.
2. Turn **Public Bot** off.
3. Use the save prompt. It should save without the default authorization-link error.
4. Find **Token** directly under **Username**.
5. Select **Reset Token**.
6. Confirm the warning.
7. Complete Discord's password or two-factor authentication check if requested.
8. Select **Copy** as soon as the token appears.
9. Put it temporarily in your password manager.

Discord normally shows a token only once. If it is lost, reset it again. Resetting immediately invalidates the old token.

## 6. Create Your Private App Repository

An empty GitHub repository cannot run Holder Rewards. The official template creates a private repository that already contains the Worker, database migrations, and deployment automation.

1. Open the [Holder Rewards Cloudflare template](https://github.com/Sheriff1980/holder-rewards-cloudflare).
2. Select **Use this template**.
3. Select **Create a new repository**.
4. Under **Owner**, choose the GitHub account that will own this community deployment.
5. Under **Repository name**, enter `holder-rewards`.
6. Under **Visibility**, select **Private**.
7. Leave **Include all branches** off.
8. Select **Create repository from template**.
9. Wait until GitHub opens the new repository.
10. Confirm it contains `src`, `migrations`, `scripts`, `package.json`, and `wrangler.jsonc`.

Do not create an empty repository and do not fork the development repository. The template supplies the complete deployable application without Git, cloning, or a terminal.

## 7. Connect Only This Repository To Cloudflare

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/).
2. Open **Workers & Pages**.
3. Select **Create application**.
4. Choose the option to import an existing Git repository.
5. Select **New GitHub connection** if this is the first Worker connected to this GitHub account.
6. On GitHub, choose **Only select repositories**.
7. Select only the private `holder-rewards` repository created in Step 6.
8. Install or authorize **Cloudflare Workers & Pages**.
9. Return to Cloudflare and select the `holder-rewards` repository.
10. Keep `main` as the production branch.
11. Use `pnpm run build` as the build command.
12. Use `pnpm run deploy` as the deploy command.
13. Keep non-production branch builds off.
14. Under the build variables and secrets, add a secret named `DISCORD_BOT_TOKEN`.
15. Paste the token from Step 5 as its value. Do not add quotes or spaces.
16. Save and deploy.
17. Wait until both the build and deployment show success.
18. Open the `workers.dev` address shown by Cloudflare.

The deployment securely installs the bot token as an encrypted Worker secret, provisions D1, and applies every database migration. Cloudflare does not need access to any other GitHub repository.

If Cloudflare reports a failed build, select **Retry deployment** once. If it fails again, read the first red error line. Do not create a database, edit a command, or copy a database ID manually.

## 8. Finish The Automatic Launch Check

The Holder Rewards setup page opens at your new `workers.dev` address.

1. Wait for **Launch check** to finish.
2. Confirm **App data** says the database is ready.
3. Confirm **Discord** says it is connected and up to date.
4. Confirm each network you plan to use says it is available.
5. If an item is red, select **Retry launch check** once.

Holder Rewards automatically discovers the Discord Application ID and Public Key, sets the Interactions Endpoint URL, and publishes the slash commands. There is no command-registration step.

## 9. Add The Bot To Your Server

1. On the setup page, select **Add bot to Discord**.
2. In Discord's **Add to Server** list, choose the server you will test.
3. Select **Continue**.
4. Confirm the requested permissions:
   - **Manage Roles**
   - **View Channels**
   - **Send Messages**
5. Select **Authorize**.
6. Complete Discord's human check if shown.

## 10. Put The Bot Above Holder Roles

Discord only allows a bot to manage roles below its own role.

1. Open your Discord server.
2. Select the server name, then **Server Settings**.
3. Select **Roles**.
4. Find the role with your bot's name.
5. Drag it above every holder role that it should add or remove.
6. Save the role order if Discord shows a save button.

Do not place the bot above owner, administrator, or staff roles it does not need to manage.

## 11. Open The Private Manager

1. Return to a channel in the Discord server.
2. Enter `/rules manage`.
3. Select the command from Discord's command list and send it.
4. Only you can see the response.
5. Select **Open holder-role manager**.

The private manager link expires. Run `/rules manage` again whenever you need a new one.

## 12. Create Your First Holder Rule

Before continuing, create an ordinary Discord role such as `Verified Holder` if the server does not already have one. Keep it below the bot's role.

In the private manager:

1. Under **Add a holder role**, choose the requirement:
   - **NFT collection balance** for an ERC-721 collection.
   - **Token balance** for an ERC-20 token.
   - **NFT trait** for an enumerable ERC-721 collection with direct token metadata.
   - **Exact NFT** for one ERC-721 token ID.
   - **ERC-1155 item balance** for one ERC-1155 token ID.
   - **Solana token or NFT mint** for an exact Solana mint.
2. Choose the Discord role to manage.
3. Choose **Any requirement** unless every rule for this same role must pass.
4. Choose the network.
5. Paste the asset's contract address. For Solana, paste the mint address.
6. Enter the minimum amount.
7. For trait and exact-item rules, complete the additional fields shown.
8. Select **Add holder role**.
9. Confirm the rule appears under **Active holder roles**.

Contract addresses and mint addresses are public identifiers, not secret keys. Never paste a wallet seed phrase or private key.

## 13. Post The Verification Panel

1. In the Discord channel where members should verify, enter `/verify panel`.
2. Send the command.
3. Confirm the bot posts a public message with a **Verify wallet** button.

Only a server manager can post this panel. Members can use the button but cannot configure rules.

## 14. Prove Wallet Ownership

Test this yourself before inviting members:

1. Select **Verify wallet** in the panel.
2. Discord shows a private response. Select **Open wallet verification**.
3. On the verification page, choose the correct network.
4. Select **Connect wallet**.
5. Approve the wallet connection.
6. Read the signature message. It must name this Holder Rewards site, your Discord member, your server, the network, and an expiration time.
7. Select **Sign** in the wallet.

This is a message signature. It is not a blockchain transaction, token approval, or transfer and should not charge gas.

The server verifies the signature before saving the address. Typing or pasting someone else's address cannot link their wallet because the attacker cannot produce that wallet's signature.

After signing:

1. Confirm the page says the wallet is linked.
2. Confirm the role refresh completed.
3. Return to Discord and confirm the expected holder role appears on your member.
4. Run `/verify status` to see your linked-wallet status.

## 15. Test Role Removal

This proves the bot does more than grant a role once.

1. Create a temporary Discord role named `Holder Test` below the bot's role.
2. Open `/rules manage` again.
3. Add a temporary copy of your qualifying rule and choose `Holder Test` as its Discord role.
4. Run `/verify refresh`.
5. Confirm `Holder Test` is added.
6. Return to `/rules manage` and remove the temporary rule.
7. Run `/verify refresh` again.
8. Confirm `Holder Test` is removed.
9. Delete the temporary Discord role.

To test an unqualified wallet too, open the verification panel as a second Discord member, link a wallet that does not own the asset, and confirm the real holder role is not added.

Automatic rechecks run throughout the day. The manager overview shows failures and provides **Retry problem members** when a provider or Discord has a temporary problem.

## 16. Test Community Rewards

1. In `/rules manage`, set the currency name and daily reward.
2. Optionally upload a currency image.
3. Select **Save rewards**.
4. In Discord, run `/points claim`.
5. Run `/points balance`.
6. Run `/points leaderboard`.
7. As a manager, test `/points grant` with a small amount and reason.
8. Confirm the new balance and manager activity appear in the private manager.

## 17. Customize And Export

In `/rules manage`, you can:

- Change the community name and accent color.
- Upload a community logo and currency image.
- Add several rules for several Discord roles.
- Combine rules for one role using **Any requirement** or **All requirements**.
- Link several EVM and Solana wallets to one Discord member.
- Download holder, balance, wallet, and audit CSV files.

Wallet exports shorten addresses by default. Turn on full-address exports only when your community actually needs them.

## 18. Your Setup Is Complete

A complete first test has all of these results:

- The Cloudflare deployment is green.
- The launch check is green.
- The bot is installed in the test server.
- The bot's role is above the holder roles.
- `/rules manage` opens the private manager.
- `/verify panel` posts the member button.
- A real wallet signature links the correct wallet.
- A qualifying wallet receives the correct role.
- An unqualified wallet does not receive the role.
- A no-longer-qualifying wallet loses the role after refresh.
- Points claim, balance, leaderboard, and manager grant work.
- Manager CSV exports download.

Keep the private GitHub repository you created from the template. It is your community's open-source copy and is also how Cloudflare receives automatic application updates.

## Common Problems

**Discord says the application has a default authorization link**

Return to **Installation**, set **Install Link** to **None**, save, then return to **Bot** and turn **Public Bot** off.

**The launch check says Discord credentials are invalid**

Reset the token on Discord's **Bot** page, then open the Worker in Cloudflare, choose **Settings**, choose **Variables and Secrets**, replace `DISCORD_BOT_TOKEN`, and deploy the change. Return to the app and select **Retry launch check**.

**The bot cannot add or remove a role**

In Discord **Server Settings** > **Roles**, move the bot's role above the holder role. The bot cannot manage administrator roles or roles above itself.

**A network check is temporarily red**

Select **Retry launch check**. Public blockchain providers sometimes throttle requests. Existing roles are preserved when ownership cannot be checked.

**A wallet opens but does not offer a signature**

Make sure the wallet is on the selected network, unlock it, return to the verification page, and select **Connect wallet** again. On a phone, use the QR code or **Share private link** to open the same private page in the wallet's browser.

**A private manager or verification link expired**

Run `/rules manage` again for a new manager link, or select **Verify wallet** in the Discord panel again for a new member link.

**The bot commands are not visible**

Wait one minute, then reload Discord. Open the Holder Rewards setup page and select **Retry launch check**. Commands are published automatically.
