import { createDb } from "@holder-rewards/db";
import { loadEnv } from "@holder-rewards/env";
import { buildWebApp } from "./server.js";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = buildWebApp({ env, db });

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

await app.listen({ port, host });

