# Community Points

The hosted Worker includes a small, append-only points ledger in D1. Balances are calculated from transactions rather than stored as a mutable number.

Members can use:

- `/points claim` to collect the configured daily amount once per UTC day.
- `/points balance` to view their balance in the current server.
- `/points leaderboard` to view the ten highest positive balances in the current server.
- `/points grant member:<member> amount:<amount> reason:<note>` lets a manager append a manual reward.

Points are isolated by Discord server. Managers can use `/rules manage` and edit **Community rewards** to change the currency name, daily amount, and currency image without redeploying. New servers start with the deployment defaults: `DAILY_CLAIM_AMOUNT` is 10 and `REWARD_CURRENCY_NAME` is `Points`.

Currency images are uploaded directly to the community's deployment and stored in D1. PNG, JPEG, GIF, and WebP files up to 512 KB are accepted. No image-hosting account, URL, or additional Cloudflare storage product is required. The image appears as a thumbnail in points responses and can be replaced or removed from the manager.

Duplicate daily claims are prevented by a D1 unique index, including simultaneous requests. Manager grants record the granting Discord user and optional reason in transaction metadata. Holder multipliers, quests, transfers, stores, and raffles remain future ledger transaction sources.
