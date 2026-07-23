FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm build

FROM base AS web
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@holder-rewards/web", "start"]

FROM base AS bot
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@holder-rewards/bot", "start"]

