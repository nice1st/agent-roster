// room 만료 스위프 동작 테스트(05 §2 #14) — 실서버(startServer)를 짧은 heartbeatIntervalMs로 띄워 실제 스위프가
// 만료 room을 폭파하는지 검증한다(05 §4 room 종료 처리 — 버튼 폭파와 같은 endRoom을 탄다).
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
import { createRoomStore, type RoomStore } from "../store/rooms";

const TEST_SECRET = "test-only-secret-room-expiry-sweep";

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
let rooms: RoomStore;
let keys: Es256KeyPair;
let started: ReturnType<typeof startServer>;

afterEach(() => {
  started.server.stop(true);
});

function api(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, started.server.url), { ...init, headers: { ...init.headers, cookie } });
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function registerAgent(userId: string, alias?: string) {
  const res = await fetch(new URL("/register", started.server.url), {
    method: "POST",
    headers: { authorization: `Bearer ${await signToken(keys.privateKey, userId)}` },
    body: JSON.stringify({ meta: alias === undefined ? {} : { alias } }),
  });
  if (res.body === null) throw new Error("no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  async function nextFrame(): Promise<Record<string, unknown>> {
    while (true) {
      let idx = buf.indexOf("\n\n");
      while (idx === -1) {
        const { done, value } = await reader.read();
        if (done) throw new Error(`stream ended without frame: ${buf}`);
        buf += decoder.decode(value, { stream: true });
        idx = buf.indexOf("\n\n");
      }
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (frame.startsWith(": keepalive")) continue; // 짧은 heartbeatIntervalMs 주입 시 keepalive 주석 프레임을 건너뜀
      return JSON.parse(frame.slice("data: ".length));
    }
  }
  const registered = await nextFrame();
  return { uuid: registered.uuid as string, nextFrame };
}

beforeEach(async () => {
  db = new Database(":memory:");
  keys = await generateEs256KeyPair();
  webAuth = createWebAuth({ db, secret: TEST_SECRET, baseURL: "http://localhost" });
  await webAuth.runMigrations();
  runDomainMigrations(db);
  groups = createGroupStore(db);
  rooms = createRoomStore(db);
});

test("스위프가 만료 room을 폭파한다(짧은 주기 주입)", async () => {
  started = startServer({
    port: 0,
    verifier: createJwtVerifier(keys.publicKey),
    hygiene: { heartbeatIntervalMs: 20 },
    webAuth,
    groupsDeps: { getUserGroups: (userId) => groups.getGroupsForUser(userId) },
    roomsDeps: { webAuth, rooms, getUserGroups: (userId) => groups.getGroupsForUser(userId) },
  });

  const owner = await createSessionUser(db, "sweep-owner@example.com");
  const agentOwner = await createSessionUser(db, "sweep-agent-owner@example.com");
  const g1 = groups.create("g1");
  groups.grant(owner.id, g1.id);
  groups.grant(agentOwner.id, g1.id);
  const agent = await registerAgent(agentOwner.id, "sweep-agent");

  const createRes = await api("/api/rooms", owner.cookie, jsonInit("POST", { name: "만료방", duration_minutes: 1 }));
  const { room } = (await createRes.json()) as { room: { id: string } };
  await api(`/api/rooms/${room.id}/participants`, owner.cookie, jsonInit("POST", { agent_uuid: agent.uuid }));
  await api(`/api/rooms/${room.id}/start`, owner.cookie, jsonInit("POST", {}));
  await agent.nextFrame(); // room-start 소비

  // 시작 시점에 확정된 ends_at을 과거로 앞당겨 다음 스위프 tick에 만료 대상이 되게 한다.
  db.prepare("UPDATE rooms SET ends_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), room.id);

  const endFrame = await agent.nextFrame();
  expect(endFrame).toEqual({ type: "room-end", room: room.id, name: "만료방", sent_at: expect.any(String) });

  // GET /api/rooms/:id 단건 조회는 없으므로 목록에서 상태를 확인한다.
  const listRes = await api("/api/rooms", owner.cookie);
  const { rooms: listed } = (await listRes.json()) as { rooms: { id: string; status: string }[] };
  const found = listed.find((r) => r.id === room.id);
  expect(found?.status).toBe("ended");
});
