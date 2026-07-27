import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { type Es256KeyPair, generateEs256KeyPair, signToken } from "../auth/keys";
import { createJwtVerifier } from "../auth/token";
import { createWebAuth, type WebAuth } from "../auth/web-auth";
import { startServer } from "../server";
import { createGroupStore, type GroupStore } from "../store/groups";
import { runDomainMigrations } from "../store/migrations";

const TEST_SECRET = "test-only-secret-agents-api";

interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

async function createSessionUser(db: Database, email: string): Promise<TestUser> {
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
  return { id: body.user.id, email, cookie };
}

let db: Database;
let webAuth: WebAuth;
let groups: GroupStore;
let keys: Es256KeyPair;
let started: ReturnType<typeof startServer>;

beforeEach(async () => {
  db = new Database(":memory:");
  keys = await generateEs256KeyPair();
  webAuth = createWebAuth({ db, secret: TEST_SECRET, baseURL: "http://localhost" });
  await webAuth.runMigrations();
  runDomainMigrations(db);
  groups = createGroupStore(db);
  started = startServer({
    port: 0,
    verifier: createJwtVerifier(keys.publicKey),
    webAuth,
    groupsDeps: { getUserGroups: (userId) => groups.getGroupsForUser(userId) },
    agentsDeps: { webAuth, getUserGroups: (userId) => groups.getGroupsForUser(userId) },
  });
});

afterEach(() => {
  started.server.stop(true);
});

async function registerAgent(userId: string): Promise<string> {
  const res = await fetch(new URL("/register", started.server.url), {
    method: "POST",
    headers: { authorization: `Bearer ${await signToken(keys.privateKey, userId)}` },
    body: "{}",
  });
  if (res.body === null) throw new Error("no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (!buf.includes("\n\n")) {
    const { done, value } = await reader.read();
    if (done) throw new Error("stream ended without frame");
    buf += decoder.decode(value, { stream: true });
  }
  const frame = JSON.parse(buf.slice("data: ".length, buf.indexOf("\n\n"))) as { uuid: string };
  return frame.uuid;
}

function agentsFetch(path: string, cookie?: string): Promise<Response> {
  return fetch(new URL(path, started.server.url), { headers: cookie === undefined ? undefined : { cookie } });
}

test("세션 없는 /api/agents는 401이다", async () => {
  const res = await agentsFetch("/api/agents");
  expect(res.status).toBe(401);
});

test("세션 없는 /api/my-agents는 401이다", async () => {
  const res = await agentsFetch("/api/my-agents");
  expect(res.status).toBe(401);
});

test("내 그룹에 노출된 에이전트가 owner email과 함께 목록에 온다", async () => {
  const viewer = await createSessionUser(db, "viewer@example.com");
  const owner = await createSessionUser(db, "owner@example.com");
  const g1 = groups.create("g1");
  groups.grant(viewer.id, g1.id);
  groups.grant(owner.id, g1.id);
  const agentUuid = await registerAgent(owner.id);

  const res = await agentsFetch("/api/agents", viewer.cookie);
  expect(res.status).toBe(200);
  const { agents } = (await res.json()) as { agents: { uuid: string; owner: { email: string } }[] };
  const found = agents.find((a) => a.uuid === agentUuid);
  expect(found?.owner.email).toBe("owner@example.com");
});

test("내 그룹 밖 에이전트는 목록에 없다", async () => {
  const viewer = await createSessionUser(db, "viewer2@example.com");
  const owner = await createSessionUser(db, "owner2@example.com");
  const g1 = groups.create("g1");
  const g2 = groups.create("g2");
  groups.grant(viewer.id, g1.id);
  groups.grant(owner.id, g2.id);
  const agentUuid = await registerAgent(owner.id);

  const res = await agentsFetch("/api/agents", viewer.cookie);
  const { agents } = (await res.json()) as { agents: { uuid: string }[] };
  expect(agents.map((a) => a.uuid)).not.toContain(agentUuid);
});

test("my-agents는 노출과 무관하게 내 소유만 돌려준다", async () => {
  const me = await createSessionUser(db, "me@example.com");
  const other = await createSessionUser(db, "other@example.com");
  const myUuid = await registerAgent(me.id);
  const otherUuid = await registerAgent(other.id);

  const res = await agentsFetch("/api/my-agents", me.cookie);
  expect(res.status).toBe(200);
  const { agents } = (await res.json()) as { agents: { uuid: string }[] };
  const uuids = agents.map((a) => a.uuid);
  expect(uuids).toContain(myUuid);
  expect(uuids).not.toContain(otherUuid);
});
