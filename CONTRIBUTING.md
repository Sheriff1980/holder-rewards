# Contributing

Thanks for helping build a self-hostable holder verification and rewards platform.

## Development

For the recommended Cloudflare application:

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm exec wrangler d1 migrations apply DB --local
pnpm dev:cloudflare
```

For the advanced Node/Docker services, copy `.env.docker.example` to `.env` and run `pnpm dev` with Postgres available.

Before opening a pull request:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Principles

- Keep the project self-hostable.
- Avoid required proprietary hosted services.
- Put secrets in environment variables, never source files.
- Prefer provider adapters over hardcoded APIs.
- Keep wallet verification messages human-readable and replay-resistant.
