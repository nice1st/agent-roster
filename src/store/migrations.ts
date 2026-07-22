// 도메인 마이그레이션 러너 — db/migrations/NNN-*.sql을 번호순으로 부팅 시 적용한다.
// 적용 이력은 schema_migrations 테이블로 추적해 멱등을 보장한다(05 §4).

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

/** db/migrations/의 SQL 파일을 번호순으로 적용한다. 이미 적용된 파일은 건너뛰어 몇 번을 불러도 결과가 같다. */
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
