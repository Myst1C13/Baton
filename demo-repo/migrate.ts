import { DB } from "./db";

export interface MigrationResult {
  ok: boolean;
}

/**
 * Add the `age` column to the `users` table.
 *
 * BUG: this runs `ALTER TABLE` unconditionally, so a second run — or a re-run
 * after a partial/crashed first attempt — throws
 * `SQLITE_ERROR: duplicate column name: age`. The migration must become
 * idempotent: safe to re-run without losing data.
 *
 * The fix is to guard the change with the existing schema, e.g.
 *   const cols = db.tableInfo("users").map((c) => c.name);
 *   if (!cols.includes("age")) db.run("ALTER TABLE users ADD COLUMN age INT");
 */
export function applyMigration(db: DB): MigrationResult {
  db.run("ALTER TABLE users ADD COLUMN age INT");
  return { ok: true };
}
