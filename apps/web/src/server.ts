import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "@holder-rewards/db";
import { checkDb } from "@holder-rewards/db";
import type { AppEnv } from "@holder-rewards/env";

export type WebAppOptions = {
  env: AppEnv;
  db: Db;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    };
    return entities[character];
  });
}

export function buildWebApp({ env, db }: WebAppOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async (_request, reply) => {
    const database = await checkDb(db).catch(() => false);

    if (!database) {
      reply.code(503);
    }

    return {
      ok: database,
      service: "web",
      database
    };
  });

  app.get("/verify", async (request, reply) => {
    const { guild_id: guildId } = request.query as { guild_id?: string };
    const appName = escapeHtml(env.APP_NAME);
    const safeGuildId = escapeHtml(guildId ?? "unknown");

    reply.type("text/html");
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${appName} Verification</title>
    <style>
      body {
        color: #1a1a1a;
        font-family: Arial, sans-serif;
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f6f7f9;
      }
      main {
        width: min(560px, calc(100% - 32px));
        background: #ffffff;
        border: 1px solid #dde1e7;
        border-radius: 8px;
        padding: 28px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
      }
      h1 {
        font-size: 26px;
        margin: 0 0 12px;
      }
      p {
        line-height: 1.5;
      }
      code {
        background: #eef1f5;
        border-radius: 4px;
        padding: 2px 5px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${appName}</h1>
      <p>Wallet verification is scaffolded and ready for the OAuth plus signature flow.</p>
      <p>This page was opened for guild: <code>${safeGuildId}</code></p>
      <p>The finished flow will never ask for token approvals or transactions.</p>
    </main>
  </body>
</html>`;
  });

  return app;
}
