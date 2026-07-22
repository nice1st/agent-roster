import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { runDomainMigrations } from "./migrations";

test("마이그레이션은 groups·user_groups 테이블을 만든다", () => {
  const db = new Database(":memory:");
  runDomainMigrations(db);
  const tables = db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
  expect(tables).toEqual(expect.arrayContaining(["groups", "user_groups", "schema_migrations"]));
});

test("마이그레이션은 두 번 실행해도 한 번만 적용된다", () => {
  const db = new Database(":memory:");
  runDomainMigrations(db);
  runDomainMigrations(db);
  const count = db.query<{ n: number }, []>("SELECT count(*) AS n FROM schema_migrations").get();
  expect(count?.n).toBe(1);
});

test("적용 후 groups 테이블에 실제로 insert할 수 있다", () => {
  const db = new Database(":memory:");
  runDomainMigrations(db);
  db.prepare("INSERT INTO groups (id, name) VALUES (?, ?)").run(crypto.randomUUID(), "g1");
  const count = db.query<{ n: number }, []>("SELECT count(*) AS n FROM groups").get();
  expect(count?.n).toBe(1);
});
