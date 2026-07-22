import { Database } from "bun:sqlite";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { startServer } from "../server";
import { authEnvFrom, createWebAuth, type WebAuth } from "./web-auth";

const denyAll = { verify: async () => null };

// 실제 시크릿이 아니다 — 테스트 전용 더미 문자열.
const TEST_SECRET = "test-only-secret";
const TEST_GOOGLE = { clientId: "test-client-id", clientSecret: "test-client-secret" };

async function createMigratedWebAuth(): Promise<{ webAuth: WebAuth; db: Database }> {
  const db = new Database(":memory:");
  const webAuth = createWebAuth({ db, secret: TEST_SECRET, google: TEST_GOOGLE, baseURL: "http://localhost" });
  await webAuth.runMigrations();
  return { webAuth, db };
}

let started: ReturnType<typeof startServer>;

beforeAll(async () => {
  const { webAuth } = await createMigratedWebAuth();
  started = startServer({ port: 0, verifier: denyAll, webAuth });
});

afterAll(() => {
  started.server.stop(true);
});

test("인증 구성 서버는 /api/auth 경로가 응답한다", async () => {
  const res = await fetch(new URL("/api/auth/ok", started.server.url));
  expect(await res.json()).toEqual({ ok: true });
});

test("세션 없는 요청의 세션 조회는 비어 있다", async () => {
  const res = await fetch(new URL("/api/auth/get-session", started.server.url));
  expect(await res.json()).toBeNull();
});

test("bootstrap-admin이 admin role 사용자를 만든다", async () => {
  const { webAuth } = await createMigratedWebAuth();
  const result = await webAuth.ensureAdminUser("admin@example.com");
  expect(result).toEqual({
    created: true,
    user: { id: expect.any(String), email: "admin@example.com", role: "admin" },
  });
});

test("부트스트랩 사용자는 emailVerified가 참이다 — 첫 Google 로그인의 연결 전제", async () => {
  const { webAuth, db } = await createMigratedWebAuth();
  await webAuth.ensureAdminUser("admin@example.com");
  const row = db.query<{ emailVerified: number }, [string]>("SELECT emailVerified FROM user WHERE email = ?");
  expect(row.get("admin@example.com")?.emailVerified).toBe(1);
});

test("이미 있는 email이면 부트스트랩이 중복 생성하지 않는다", async () => {
  const { webAuth, db } = await createMigratedWebAuth();
  await webAuth.ensureAdminUser("admin@example.com");
  const second = await webAuth.ensureAdminUser("admin@example.com");
  const count = db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM user WHERE email = ?");
  expect({ created: second.created, users: count.get("admin@example.com")?.n }).toEqual({ created: false, users: 1 });
});

test("인증 env가 없으면 누락 키를 나열하며 실패한다", () => {
  expect(() => authEnvFrom({ GOOGLE_CLIENT_ID: "x" })).toThrow("GOOGLE_CLIENT_SECRET, BETTER_AUTH_SECRET");
});

test("인증 env 4종을 읽고 DB 경로 미설정은 기본값을 쓴다", () => {
  const env = { GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", BETTER_AUTH_SECRET: "c" };
  expect(authEnvFrom(env)).toEqual({
    googleClientId: "a",
    googleClientSecret: "b",
    secret: "c",
    dbPath: "./data/broker.db",
  });
});
