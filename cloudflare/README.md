# Holder Rewards For Cloudflare

This repository is the standalone Cloudflare deployment template. It contains the hosted Worker, D1 migrations, scheduler, Discord interactions, wallet verification, holder roles, and rewards manager.

Normal operators should begin with the official [Start Here guide](https://github.com/Sheriff1980/holder-rewards/blob/main/docs/START_HERE.md).

A community creates a private repository from this template before connecting Cloudflare. This allows the Cloudflare GitHub App to receive access to only the community's Holder Rewards repository.

Generated community repositories check the latest official Holder Rewards release each week. When an update is available, the updater synchronizes the release and pushes it to the production branch so Cloudflare can redeploy and apply migrations automatically.
