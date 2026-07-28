# Sales Bot

The sales bot posts to a Discord channel when an NFT from a watched collection sells. It runs entirely inside the hosted Worker on the existing scheduled job — no extra service, account, or always-on machine.

## Requirements

Sale detection needs marketplace-aware data that raw RPC cannot provide reliably, so each watched network needs an **NFT indexer URL** configured under `/rules manage` → **Advanced network settings** (the same Alchemy-compatible setting used for trait rules; see [chain support](CHAINS.md)). Without it, watches cannot be created.

## Setup

In the browser manager's **Sales bot** section:

1. Pick the EVM network, paste the collection's contract address, and choose the channel for posts.
2. Save. The next scheduled pass starts the watch at the current chain state — historical sales are never backfilled or posted.

Each scheduled run (every 15 minutes by default) asks the indexer for sales newer than the watch's cursor and posts them oldest-first, capped at five posts per collection per run so a busy collection cannot flood the channel. Posts include the NFT name and image, price, marketplace, buyer, seller, and a transaction link from the chain's explorer.

## Behavior and limits

- EVM networks only for v1. Solana sale posts are tracked as future work because they need a different (parsed-transaction) provider.
- A watch that errors — an indexer outage, a removed channel, a missing permission — records the problem on the watch row and shows it in the manager; other watches are unaffected. Once the cause is fixed, the next run resumes from the last good cursor.
- One watch per collection per server. Removing a watch stops future posts; it does not delete past ones.
- Discord requires the bot to have permission to send messages in the chosen channel.
