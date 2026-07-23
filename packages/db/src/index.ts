import pg from "pg";

export type Db = pg.Pool;

export function createDb(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl });
}

export async function checkDb(db: Db): Promise<boolean> {
  const result = await db.query<{ ok: number }>("select 1 as ok");
  return result.rows[0]?.ok === 1;
}

