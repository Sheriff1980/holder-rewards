# Community Points

The hosted Worker includes a small, append-only points ledger in D1. Balances are calculated from transactions rather than stored as a mutable number.

Members can use:

- `/points claim` to collect the configured daily amount once per UTC day.
- `/points balance` to view their balance in the current server.
- `/points leaderboard` to view the ten highest positive balances in the current server.
- `/points grant member:<member> amount:<amount> reason:<note>` lets a manager append a manual reward.
- `/tip member:<member> amount:<amount>` to send points to another member.

Points are isolated by Discord server. Managers can use `/rules manage` and edit **Community rewards** to change the currency name, daily amount, holder reward, daily tipping limit, and currency image without redeploying. New servers start with the deployment defaults: `DAILY_CLAIM_AMOUNT` is 10 and `REWARD_CURRENCY_NAME` is `Points`.

Currency images are uploaded directly to the community's deployment and stored in D1. PNG, JPEG, GIF, and WebP files up to 512 KB are accepted. No image-hosting account, URL, or additional Cloudflare storage product is required. The image appears as a thumbnail in points responses and can be replaced or removed from the manager.

Duplicate daily claims are prevented by a D1 unique index, including simultaneous requests. Manager grants record the granting Discord user and optional reason in transaction metadata.

## Tipping

`/tip` moves points between members as a pair of ledger transactions. A tip never spends more than the sender's balance, and each member's total tips per UTC day are capped by the manager's **Daily tipping limit** setting (default 100; `0` turns tipping off). Bots cannot receive tips, and self-tips are rejected. The daily cap is the anti-farming control: farming accounts can only move the capped amount per day, and fraudulent points a manager revokes by ledger audit leave no positive balance behind.

## Quests

Managers create quests in the browser manager; members see them with `/quests list` and complete them with the Check buttons or `/quests code`. Each quest pays once per member, enforced by a completion table rather than trust. Four kinds are available:

- **Link a wallet** completes when the member has at least one linked wallet.
- **Hold a role** completes when the member currently has a manager-chosen Discord role.
- **Collect daily rewards** completes after the configured number of distinct daily-claim days.
- **Secret code** completes when the member submits the manager's code (stored only as a SHA-256 hash, matched case-insensitively).
- **Custom** quests carry manager instructions for anything ("retweet and comment on this post", join an event, create fan art). Members paste proof in a Discord popup; the manager approves or rejects it in the browser manager. Approval pays automatically, rejection lets the member submit again.

Quests that depend on what members say or react to in Discord are intentionally absent: this bot receives interactions only and cannot read message content.

## Raffles

Managers open a raffle with a title, a prize, an entry cost, and a per-member entry cap. Members browse with `/raffle list` and buy entries with `/raffle enter`. Entry costs are ledger spend rows, so a cancelled raffle refunds every entrant exactly. Drawing picks a weighted-random winner from all entries. A raffle can attach an automatic prize role that the bot grants on the spot; otherwise the manager fulfills the prize manually from the winner shown in the manager.

## Store

Managers list store items with a price, an optional automatic role, and optional limited stock. Members browse with `/store list` and buy with `/store buy`. Stock is decremented atomically before charging, and if a role grant fails because of Discord role hierarchy, the purchase is fully rolled back and the member is not charged. Items without an automatic role appear in the manager's **Recent purchases** feed for manual fulfillment.
