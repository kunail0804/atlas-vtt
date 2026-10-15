/**
 * The part of Cloudflare D1 the service uses. The Worker hands it D1 itself; the tests hand it
 * Node's built-in SQLite behind the same shape, so the same SQL runs on the same engine.
 */
export interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface Database {
  prepare(sql: string): Statement;
}

/** Whether a database error is a broken UNIQUE or PRIMARY KEY constraint, as D1 and SQLite word it. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
