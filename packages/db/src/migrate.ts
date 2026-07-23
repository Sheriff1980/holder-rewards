import { readFile } from "node:fs/promises";
import { createDb } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run Postgres migrations.");
}

const schemaUrl = new URL("../schema.sql", import.meta.url);
const schema = await readFile(schemaUrl, "utf8");
const db = createDb(databaseUrl);

try {
  await db.query(schema);
  console.log("Postgres migrations applied.");
} finally {
  await db.end();
}
