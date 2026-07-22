// 저장소 열기 — 단일 파일 SQLite, WAL 모드(05 §4). 스키마 적용은 호출자 몫이다.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_BROKER_DB_PATH = "./data/broker.db";

/** env에서 DB 경로를 읽는다 — 미설정·빈 값은 기본 경로. */
export function brokerDbPathFrom(env: Record<string, string | undefined>): string {
  const raw = env.BROKER_DB_PATH;
  return raw === undefined || raw.trim() === "" ? DEFAULT_BROKER_DB_PATH : raw;
}

export function openBrokerDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL;");
  return db;
}
