/**
 * Tiny in-memory stand-in for a SQLite database.
 *
 * Just enough to make the users.age migration demo real and deterministic with
 * no native dependencies. It models the one behavior that matters here: an
 * `ALTER TABLE ... ADD COLUMN` fails with a SQLITE_ERROR if the column already
 * exists, and `PRAGMA table_info(table)` (via `tableInfo`) lists the columns so
 * a migration can guard itself before altering.
 */

export interface ColumnInfo {
  name: string;
  type: string;
}

interface Table {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
}

export class DB {
  private readonly tables = new Map<string, Table>();

  /** Seed a table with columns + rows (test setup). */
  seed(
    table: string,
    columns: ColumnInfo[],
    rows: Record<string, unknown>[]
  ): void {
    this.tables.set(table, {
      columns: columns.map((c) => ({ ...c })),
      rows: rows.map((r) => ({ ...r })),
    });
  }

  /** Column metadata — the SQLite `PRAGMA table_info(table)` shape. */
  tableInfo(table: string): ColumnInfo[] {
    return this.table(table).columns.map((c) => ({ ...c }));
  }

  /** Execute a minimal subset of SQL: `ALTER TABLE <t> ADD COLUMN <c> <type>`. */
  run(sql: string): void {
    const alter = /^\s*ALTER TABLE (\w+) ADD COLUMN (\w+) (\w+)/i.exec(sql);
    if (!alter) {
      throw new Error(`unsupported SQL in demo DB: ${sql}`);
    }
    const [, table, column, type] = alter;
    const t = this.table(table);
    if (t.columns.some((c) => c.name === column)) {
      // Faithful to real SQLite — this is the failure the migration must avoid.
      throw new Error(`SQLITE_ERROR: duplicate column name: ${column}`);
    }
    t.columns.push({ name: column, type });
    for (const row of t.rows) row[column] = null;
  }

  /** Read rows back (to prove existing data is preserved). */
  rows(table: string): Record<string, unknown>[] {
    return this.table(table).rows.map((r) => ({ ...r }));
  }

  private table(name: string): Table {
    const t = this.tables.get(name);
    if (!t) throw new Error(`no such table: ${name}`);
    return t;
  }
}
