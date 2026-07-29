import Database from "better-sqlite3";

type BindValue = string | number | bigint | null | ArrayBuffer | ArrayBufferView;

type RunResult = {
  success: boolean;
  meta: {
    changes: number;
    last_row_id: number;
    duration: number;
  };
};

function normalizeValue(value: BindValue): string | number | bigint | null | Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value as string | number | bigint | null | Uint8Array;
}

export class NodeD1Statement {
  private values: BindValue[] = [];

  constructor(
    private readonly db: Database.Database,
    private readonly sql: string
  ) {}

  bind(...values: BindValue[]): this {
    this.values = values;
    return this;
  }

  runSync(): RunResult {
    const info = this.db
      .prepare(this.sql)
      .run(...this.values.map(normalizeValue) as never[]);
    return {
      success: true,
      meta: {
        changes: info.changes,
        last_row_id: Number(info.lastInsertRowid),
        duration: 0
      }
    };
  }

  async run(): Promise<RunResult> {
    return this.runSync();
  }

  async first<T>(): Promise<T | null> {
    const row = this.db
      .prepare(this.sql)
      .get(...this.values.map(normalizeValue) as never[]) as T | undefined;
    return row === undefined ? null : row;
  }

  async all<T>(): Promise<{ success: boolean; results: T[]; meta: { duration: number } }> {
    const results = this.db
      .prepare(this.sql)
      .all(...this.values.map(normalizeValue) as never[]) as T[];
    return { success: true, results, meta: { duration: 0 } };
  }
}

export class NodeD1Database {
  constructor(private readonly db: Database.Database) {}

  prepare(sql: string): NodeD1Statement {
    return new NodeD1Statement(this.db, sql);
  }

  async batch(statements: NodeD1Statement[]): Promise<RunResult[]> {
    return this.db.transaction(() => statements.map((statement) => statement.runSync()))();
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  get sqlite(): Database.Database {
    return this.db;
  }
}

export function createNodeD1(path: string): NodeD1Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return new NodeD1Database(db);
}
