// 세션이 필요한 관리자 API 동작 테스트. 세션 생성 방법(테스트 전용, web-auth.ts에는 없음):
// emailAndPassword를 켠 별도 betterAuth 인스턴스(같은 db·secret)로 signUpEmail을 실제로 호출해
// Set-Cookie를 받는다. 세션은 DB(secondary storage 없음)에 저장되고 쿠키 서명도 secret 기반이라
// 프로덕션 webAuth(다른 옵션 인스턴스)에서도 같은 db·secret이면 그대로 유효하다(실행 검증).
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { createWebAuth, type WebAuth } from "../auth/web-auth";
import { startServer } from "../server";
import { runDomainMigrations } from "../store/migrations";
import { createAdminApiRoutes } from "./admin";

const TEST_SECRET = "test-only-secret-admin-api";

interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

/** 테스트 전용 — signUpEmail로 실제 세션을 만들고 role을 지정해 쿠키를 돌려준다. */
async function createSessionUser(db: Database, email: string, role: "user" | "admin"): Promise<TestUser> {
  const signupAuth = betterAuth({
    database: db,
    secret: TEST_SECRET,
    baseURL: "http://localhost",
    emailAndPassword: { enabled: true },
    plugins: [admin()],
  });
  const res = await signupAuth.api.signUpEmail({
    body: { email, password: "password-not-real-1234", name: email },
    asResponse: true,
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (cookie === undefined) throw new Error("no set-cookie from signUpEmail");
  const body = (await res.json()) as { user: { id: string } };
  if (role === "admin") {
    db.prepare("UPDATE user SET role = ? WHERE id = ?").run("admin", body.user.id);
  }
  return { id: body.user.id, email, cookie };
}

let db: Database;
let webAuth: WebAuth;
let started: ReturnType<typeof startServer>;

beforeEach(() => {
  db = new Database(":memory:");
});

async function bootServer() {
  webAuth = createWebAuth({ db, secret: TEST_SECRET, baseURL: "http://localhost" });
  await webAuth.runMigrations();
  runDomainMigrations(db);
  started = startServer({
    port: 0,
    verifier: { verify: async () => null },
    webAuth,
    adminRoutes: createAdminApiRoutes({ webAuth, db }),
  });
}

afterEach(() => {
  started?.server.stop(true);
});

function adminFetch(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, started.server.url), {
    ...init,
    headers: { ...init.headers, cookie },
  });
}

test("admin이 아닌 세션의 /api/admin 요청은 403이다", async () => {
  await bootServer();
  const normalUser = await createSessionUser(db, "normal@example.com", "user");
  const res = await adminFetch("/api/admin/users", normalUser.cookie);
  expect(res.status).toBe(403);
});

test("세션이 없는 /api/admin 요청도 403이다", async () => {
  await bootServer();
  const res = await fetch(new URL("/api/admin/users", started.server.url));
  expect(res.status).toBe(403);
});

test("관리자가 만든 사용자는 emailVerified가 참이다", async () => {
  await bootServer();
  const adminUser = await createSessionUser(db, "admin@example.com", "admin");
  const res = await adminFetch("/api/admin/users", adminUser.cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "created@example.com" }),
  });
  expect(res.status).toBe(201);
  const row = db
    .query<{ emailVerified: number }, [string]>("SELECT emailVerified FROM user WHERE email = ?")
    .get("created@example.com");
  expect(row?.emailVerified).toBe(1);
});

test("자기 자신 삭제는 400이다", async () => {
  await bootServer();
  const adminUser = await createSessionUser(db, "admin2@example.com", "admin");
  const res = await adminFetch(`/api/admin/users/${adminUser.id}`, adminUser.cookie, { method: "DELETE" });
  expect(res.status).toBe(400);
});

test("그룹을 삭제하면 그 그룹의 멤버십도 사라진다", async () => {
  await bootServer();
  const adminUser = await createSessionUser(db, "admin3@example.com", "admin");
  const target = await createSessionUser(db, "member@example.com", "user");

  const groupRes = await adminFetch("/api/admin/groups", adminUser.cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "g1" }),
  });
  const { group } = (await groupRes.json()) as { group: { id: string } };

  await adminFetch("/api/admin/user-groups", adminUser.cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: target.id, groupId: group.id }),
  });
  const before = db
    .query<{ n: number }, [string]>("SELECT count(*) AS n FROM user_groups WHERE group_id = ?")
    .get(group.id);
  expect(before?.n).toBe(1);

  const deleteRes = await adminFetch(`/api/admin/groups/${group.id}`, adminUser.cookie, { method: "DELETE" });
  expect(deleteRes.status).toBe(200);

  const after = db
    .query<{ n: number }, [string]>("SELECT count(*) AS n FROM user_groups WHERE group_id = ?")
    .get(group.id);
  expect(after?.n).toBe(0);
});

test("사용자를 삭제하면 그의 user_groups도 정리된다", async () => {
  await bootServer();
  const adminUser = await createSessionUser(db, "admin4@example.com", "admin");
  const target = await createSessionUser(db, "member2@example.com", "user");

  const groupRes = await adminFetch("/api/admin/groups", adminUser.cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "g2" }),
  });
  const { group } = (await groupRes.json()) as { group: { id: string } };

  await adminFetch("/api/admin/user-groups", adminUser.cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: target.id, groupId: group.id }),
  });

  const deleteRes = await adminFetch(`/api/admin/users/${target.id}`, adminUser.cookie, { method: "DELETE" });
  expect(deleteRes.status).toBe(200);

  const after = db
    .query<{ n: number }, [string]>("SELECT count(*) AS n FROM user_groups WHERE user_id = ?")
    .get(target.id);
  expect(after?.n).toBe(0);
});

test("user_group 부여·회수가 사용자 목록의 groupIds에 반영된다", async () => {
  await bootServer();
  const adminUser = await createSessionUser(db, "admin5@example.com", "admin");
  const target = await createSessionUser(db, "member3@example.com", "user");

  const groupRes = await adminFetch("/api/admin/groups", adminUser.cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "g3" }),
  });
  const { group } = (await groupRes.json()) as { group: { id: string } };

  await adminFetch("/api/admin/user-groups", adminUser.cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: target.id, groupId: group.id }),
  });

  const listRes = await adminFetch("/api/admin/users", adminUser.cookie);
  const { users } = (await listRes.json()) as { users: { id: string; groupIds: string[] }[] };
  const found = users.find((u) => u.id === target.id);
  expect(found?.groupIds).toEqual([group.id]);

  await adminFetch("/api/admin/user-groups", adminUser.cookie, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: target.id, groupId: group.id }),
  });

  const listRes2 = await adminFetch("/api/admin/users", adminUser.cookie);
  const { users: users2 } = (await listRes2.json()) as { users: { id: string; groupIds: string[] }[] };
  const found2 = users2.find((u) => u.id === target.id);
  expect(found2?.groupIds).toEqual([]);
});
