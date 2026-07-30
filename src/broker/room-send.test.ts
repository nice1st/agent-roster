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

const TEST_SECRET = "test-only-secret-room-send";

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

beforeEach(async () => {
  db = new Database(":memory:");
  keys = await generateEs256KeyPair();
  webAuth = createWebAuth({ db, secret: TEST_SECRET, baseURL: "http://localhost" });
  await webAuth.runMigrations();
  runDomainMigrations(db);
  groups = createGroupStore(db);
  rooms = createRoomStore(db);
  started = startServer({
    port: 0,
    verifier: createJwtVerifier(keys.publicKey),
    webAuth,
    groupsDeps: { getUserGroups: (userId) => groups.getGroupsForUser(userId) },
    agentsDeps: { webAuth, getUserGroups: (userId) => groups.getGroupsForUser(userId) },
    roomsDeps: { webAuth, rooms, getUserGroups: (userId) => groups.getGroupsForUser(userId) },
  });
});

afterEach(() => {
  started.server.stop(true);
});

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
    let idx = buf.indexOf("\n\n");
    while (idx === -1) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`stream ended without frame: ${buf}`);
      buf += decoder.decode(value, { stream: true });
      idx = buf.indexOf("\n\n");
    }
    const frame = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    return JSON.parse(frame.slice("data: ".length));
  }
  const registered = await nextFrame();
  return { uuid: registered.uuid as string, nextFrame };
}

function api(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, started.server.url), { ...init, headers: { ...init.headers, cookie } });
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function roomSend(body: unknown): Promise<Response> {
  return fetch(new URL("/room-send", started.server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function setUpActiveRoom() {
  const owner = await createSessionUser(db, `owner-${crypto.randomUUID()}@example.com`);
  const a1owner = await createSessionUser(db, `a1-${crypto.randomUUID()}@example.com`);
  const a2owner = await createSessionUser(db, `a2-${crypto.randomUUID()}@example.com`);
  const g1 = groups.create(`g-${crypto.randomUUID()}`);
  groups.grant(owner.id, g1.id);
  groups.grant(a1owner.id, g1.id);
  groups.grant(a2owner.id, g1.id);
  const agent1 = await registerAgent(a1owner.id, "agent-1");
  const agent2 = await registerAgent(a2owner.id, "agent-2");

  const createRes = await api("/api/rooms", owner.cookie, jsonInit("POST", { name: "토론방" }));
  const { room } = (await createRes.json()) as { room: { id: string } };

  await api(`/api/rooms/${room.id}/participants`, owner.cookie, jsonInit("POST", { agent_uuid: agent1.uuid }));
  await api(`/api/rooms/${room.id}/participants`, owner.cookie, jsonInit("POST", { agent_uuid: agent2.uuid }));
  await api(`/api/rooms/${room.id}/start`, owner.cookie, jsonInit("POST", {}));
  // room-start 프레임을 각자 소비해 room-message와 섞이지 않게 한다.
  await agent1.nextFrame();
  await agent2.nextFrame();

  return { owner, roomId: room.id, agent1, agent2 };
}

test("발신자는 자기 room 발언을 돌려받지 않는다", async () => {
  const { roomId, agent1, agent2 } = await setUpActiveRoom();

  const res = await roomSend({ from: agent1.uuid, room: roomId, message: "안녕하세요" });
  expect(await res.json()).toEqual({ ok: true });
  await agent2.nextFrame(); // 팬아웃 순서를 고정하기 위해 다른 참여자가 먼저 소비한다

  // agent1의 스트림에 자기 발언 echo가 없다면 다음 프레임은 agent2가 보낸 이 발언이어야 한다
  await roomSend({ from: agent2.uuid, room: roomId, message: "네 반갑습니다" });
  const frame = await agent1.nextFrame();
  expect(frame).toEqual({
    type: "room-message",
    room: roomId,
    from: agent2.uuid,
    from_label: "agent-2",
    sent_at: expect.any(String),
    message: "네 반갑습니다",
  });
});

test("발언은 여전히 기록된다", async () => {
  const { roomId, agent1, agent2 } = await setUpActiveRoom();

  await roomSend({ from: agent1.uuid, room: roomId, message: "안녕하세요" });
  await agent2.nextFrame(); // 팬아웃 소비

  const stored = rooms.listMessages(roomId);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ from_uuid: agent1.uuid, from_label: "agent-1", content: "안녕하세요" });
});

test("다른 참가자와 관전 구독자는 그대로 받는다", async () => {
  const { owner, roomId, agent1, agent2 } = await setUpActiveRoom();

  // 이 스위트는 chatDeps를 마운트하지 않으므로 register 엔드포인트로 웹 세션과 동일한 엔트리를 흉내낸다.
  const webRes = await fetch(new URL("/register", started.server.url), {
    method: "POST",
    headers: { authorization: `Bearer ${await signToken(keys.privateKey, owner.id)}` },
    body: "{}",
  });
  if (webRes.body === null) throw new Error("no body");
  const reader = webRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  async function nextFrame(): Promise<Record<string, unknown>> {
    let idx = buf.indexOf("\n\n");
    while (idx === -1) {
      const { done, value } = await reader.read();
      if (done) throw new Error("stream ended without frame");
      buf += decoder.decode(value, { stream: true });
      idx = buf.indexOf("\n\n");
    }
    const frame = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    return JSON.parse(frame.slice("data: ".length));
  }
  const registered = await nextFrame();
  const webUuid = registered.uuid as string;

  const watchRes = await api(`/api/rooms/${roomId}/watch`, owner.cookie, jsonInit("POST", { uuid: webUuid }));
  expect(watchRes.status).toBe(200);

  await roomSend({ from: agent1.uuid, room: roomId, message: "관전자에게도 보이나" });

  const frame2 = await agent2.nextFrame();
  expect(frame2).toEqual({
    type: "room-message",
    room: roomId,
    from: agent1.uuid,
    from_label: "agent-1",
    sent_at: expect.any(String),
    message: "관전자에게도 보이나",
  });

  const webFrame = await nextFrame();
  expect(webFrame).toMatchObject({ type: "room-message", room: roomId, message: "관전자에게도 보이나" });
});

test("비참여자의 room-send는 거부된다", async () => {
  const { roomId } = await setUpActiveRoom();
  const outsiderOwner = await createSessionUser(db, "outsider@example.com");
  const outsider = await registerAgent(outsiderOwner.id);

  const res = await roomSend({ from: outsider.uuid, room: roomId, message: "난 참여자가 아니다" });
  expect(await res.json()).toEqual({ ok: false, error: "Not a participant" });
});

test("active가 아닌 room 발언은 거부된다", async () => {
  const owner = await createSessionUser(db, "draft-owner@example.com");
  const createRes = await api("/api/rooms", owner.cookie, jsonInit("POST", { name: "draft방" }));
  const { room } = (await createRes.json()) as { room: { id: string } };

  const res = await roomSend({ from: crypto.randomUUID(), room: room.id, message: "아직 시작 전" });
  expect(await res.json()).toEqual({ ok: false, error: "Room not active" });
});

test("ends_at이 지난 room 발언은 즉시 거부된다", async () => {
  const { roomId, agent1 } = await setUpActiveRoom();
  // ends_at을 과거로 직접 앞당긴다 — 만료 검사가 status와 무관하게 ends_at을 봄을 결정론적으로 검증한다.
  db.prepare("UPDATE rooms SET ends_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), roomId);

  const res = await roomSend({ from: agent1.uuid, room: roomId, message: "이미 늦었다" });
  expect(await res.json()).toEqual({ ok: false, error: "Room not active" });
});

test("폭파된(ended) room 발언은 거부된다", async () => {
  const { roomId, agent1 } = await setUpActiveRoom();
  db.prepare("UPDATE rooms SET status = 'ended' WHERE id = ?").run(roomId);

  const res = await roomSend({ from: agent1.uuid, room: roomId, message: "이미 끝났다" });
  expect(await res.json()).toEqual({ ok: false, error: "Room not active" });
});
