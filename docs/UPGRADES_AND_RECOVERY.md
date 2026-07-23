# Updates, Backups, and Recovery

## Ordinary Updates

The hosted Cloudflare deployment applies new D1 migrations before deploying the new Worker. An operator using the recommended GitHub-to-Cloudflare path should only need to redeploy the newer project version. Do not edit or rerun old migration files; D1 records completed files in its `d1_migrations` table and applies only new ones in order.

Before a significant update, confirm the current deployment is healthy and note the current D1 recovery bookmark. The commands below are for an advanced operator or a helper; ordinary Discord managers do not need a terminal for day-to-day use.

```bash
pnpm exec wrangler d1 time-travel info holder-rewards
pnpm exec wrangler d1 migrations list DB --remote
pnpm deploy
```

After deployment, open the Worker URL and confirm **App is online** and **Discord is connected and up to date**. Existing Discord commands synchronize automatically.

## Automatic Recovery Window

Cloudflare D1 Time Travel is enabled automatically. At the time of writing, the recovery window is seven days on Workers Free and 30 days on Workers Paid. Retrieve the current bookmark before a risky operation:

```bash
pnpm exec wrangler d1 time-travel info holder-rewards
```

To locate a restore point by RFC 3339 timestamp:

```bash
pnpm exec wrangler d1 time-travel info holder-rewards --timestamp="2026-07-22T18:00:00Z"
```

## Restore After a Bad Change

Restoring overwrites the live database and cancels in-flight queries. First record the current bookmark so the restore itself can be undone. Then restore to the known-good bookmark or timestamp:

```bash
pnpm exec wrangler d1 time-travel info holder-rewards
pnpm exec wrangler d1 time-travel restore holder-rewards --bookmark=<GOOD_BOOKMARK>
```

Keep the `previous_bookmark` printed by the restore command. It can restore the state that existed immediately before recovery if the wrong point was selected.

After restoring an older database, redeploy the matching application version or run the current migrations before serving current code:

```bash
pnpm exec wrangler d1 migrations apply DB --remote
pnpm exec wrangler deploy
```

## Longer-Lived Export

Time Travel is intended for recent recovery. For an offline SQL export retained longer than the recovery window:

```bash
pnpm exec wrangler d1 export holder-rewards --remote --output=./holder-rewards-backup.sql
```

The export contains Discord-to-wallet relationships, reward balances, settings, and audit history. Store it as personal data, restrict access, and never commit it to GitHub. Cloudflare notes that a running export temporarily blocks other database requests, so create it during a quiet period.

Import an export into a newly created empty D1 database with:

```bash
pnpm exec wrangler d1 execute <NEW_DATABASE_NAME> --remote --file=./holder-rewards-backup.sql
```

Update the D1 database binding to the new database only after validating its tables and application health. Secrets such as the Discord bot token are not stored in D1 and must be restored separately through Cloudflare's encrypted secret settings.

## Migration Rules for Contributors

- Add a new sequential `.sql` file under `migrations`; never rewrite a released migration.
- Keep schema changes backward-compatible with the Worker version being replaced whenever possible.
- Apply migrations locally and run the full verification suite before opening a pull request.
- Treat destructive column/table changes as a staged migration: add and backfill first, switch code second, remove obsolete data in a later release.
- Document recovery-sensitive changes in `CHANGELOG.md`.

Cloudflare references: [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), and [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
