import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_MIGRATIONS_DIR = join(import.meta.dir, "../../db/migrations");

const FILENAME_PATTERN = /^\d+.*\.sql$/;

interface MigrationFile {
  name: string;
  sql: string;
}

function loadMigrationFiles(dir: string): MigrationFile[] {
  const names = readdirSync(dir)
    .filter((name) => FILENAME_PATTERN.test(name))
    .sort();
  return names.map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

function ensureHistoryTable(db: Database): void {
  db.run("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
}

export function runDomainMigrations(db: Database, dir: string = DEFAULT_MIGRATIONS_DIR): void {
  ensureHistoryTable(db);
  const applied = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM schema_migrations")
      .all()
      .map((r) => r.name),
  );
  const insertHistory = db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");

  for (const file of loadMigrationFiles(dir)) {
    if (applied.has(file.name)) continue;
    db.transaction(() => {
      db.run(file.sql);
      insertHistory.run(file.name, new Date().toISOString());
    })();
  }
}
