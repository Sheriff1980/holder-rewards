import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

export function applyMigrations(db: Database.Database, migrationsDir: string): number {
  db.exec(
    "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
  );
  const applied = new Set(
    (db.prepare("SELECT name FROM d1_migrations").all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  );
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(file);
    })();
    appliedCount += 1;
  }
  return appliedCount;
}
