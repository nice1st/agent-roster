import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_BROKER_DB_PATH = "./data/broker.db";

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
