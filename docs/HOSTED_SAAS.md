# Hosted SaaS Operator Guide

This guide is for the person operating the shared hosted Holder Rewards service. Communities using the service do not create bots, copy tokens, configure domains, or run commands.

## Before A Public Multi-Community Launch

The hosted onboarding and Drip migration flows are implemented, but a public SaaS launch still requires the tenant-isolation audit, billing, production queues, monitoring, backups, legal documents, and support workflow listed in `TODO.md`.

## Configure The Shared Discord Application

Use one Discord application for the hosted service.

1. Open the Discord Developer Portal and select the hosted Holder Rewards application.
2. Open **OAuth2**.
3. Add this redirect address, replacing the example domain with the hosted app domain:

   `https://rewards.example.com/hosted/callback`

4. Save the change.
5. Copy the **Application ID** from **General Information**.
6. Copy or reset the **Client Secret** on the OAuth2 page and treat it like the bot token.
7. Configure the hosted runtime values:

   - `DISCORD_APPLICATION_ID`: the public application ID.
   - `DISCORD_CLIENT_SECRET`: the secret OAuth credential.

The client secret enables `/hosted`. Without it, self-hosted behavior remains unchanged and the hosted route returns Not Found.

## Community Onboarding

Send a community manager to:

`https://rewards.example.com/hosted`

The manager signs in with Discord. Holder Rewards keeps only a short-lived list of servers where that account has **Manage Server** or Administrator permission. It does not retain the Discord user access token. The manager chooses a server, adds the shared bot if needed, and continues into the existing private manager.

## Drip Migration

The manager opens **Move rewards from Drip** in the private manager and chooses either:

- **Connect Drip** with a Realm ID, currency name or ID, and temporary read-only API key.
- **Upload CSV** with `discord_user_id` and `balance` columns.

The Drip API key should have only `realm:read` and `members:read`. The key is used for that preview request and is never written to the database.

Every migration follows this sequence:

1. Read and validate the source rows.
2. Combine duplicate Discord IDs.
3. Show matched members, skipped rows, conversion ratio, and totals.
4. Import deterministic append-only ledger transactions.
5. Make retries harmless so balances cannot be doubled.
6. Allow an exact audited rollback batch.

Importing copies balances. Stop Drip earning and spending at the selected cutoff before applying the batch, or members could spend in both systems.

The first release imports member currency balances. NFT-bound Drip generator balances are not included.
