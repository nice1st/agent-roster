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

const TEST_SECRET = "test-only-secret-rooms-api";

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

test("세션 없이 room 생성은 401이다", async () => {
  const res = await fetch(new URL("/api/rooms", started.server.url), jsonInit("POST", { name: "r1" }));
  expect(res.status).toBe(401);
});

test("room 생성·목록이 동작한다", async () => {
  const user = await createSessionUser(db, "owner@example.com");
  const createRes = await api("/api/rooms", user.cookie, jsonInit("POST", { name: "토론방", context: "ctx" }));
  expect(createRes.status).toBe(201);
  const { room } = (await createRes.json()) as { room: { id: string; status: string } };
  expect(room.status).toBe("draft");

  const listRes = await api("/api/rooms", user.cookie);
  const { rooms: listed } = (await listRes.json()) as { rooms: { id: string }[] };
  expect(listed.map((r) => r.id)).toContain(room.id);
});

test("room 참여자 배치가 동작한다", async () => {
  const owner = await createSessionUser(db, "owner2@example.com");
  const agentOwner = await createSessionUser(db, "agent-owner@example.com");
  const g1 = groups.create("g1");
  groups.grant(owner.id, g1.id);
  groups.grant(agentOwner.id, g1.id);
  const agent = await registerAgent(agentOwner.id, "my-agent");

  const createRes = await api("/api/rooms", owner.cookie, jsonInit("POST", { name: "r" }));
  const { room } = (await createRes.json()) as { room: { id: string } };

  const addRes = await api(
    `/api/rooms/${room.id}/participants`,
    owner.cookie,
    jsonInit("POST", { agent_uuid: agent.uuid, persona: "친절한 리뷰어" }),
  );
  expect(addRes.status).toBe(201);
});

test("배치는 보이는 에이전트만 허용된다", async () => {
  const owner = await createSessionUser(db, "owner3@example.com");
  const agentOwner = await createSessionUser(db, "agent-owner3@example.com");
  const g1 = groups.create("g1");
  const g2 = groups.create("g2");
  groups.grant(owner.id, g1.id);
  groups.grant(agentOwner.id, g2.id); // 교집합 없음
  const agent = await registerAgent(agentOwner.id);

  const createRes = await api("/api/rooms", owner.cookie, jsonInit("POST", { name: "r" }));
  const { room } = (await createRes.json()) as { room: { id: string } };

  const addRes = await api(
    `/api/rooms/${room.id}/participants`,
    owner.cookie,
    jsonInit("POST", { agent_uuid: agent.uuid }),
  );
  expect(addRes.status).toBe(403);
});

test("남의 room 조작은 403이다", async () => {
  const owner = await createSessionUser(db, "owner4@example.com");
  const intruder = await createSessionUser(db, "intruder4@example.com");
  const createRes = await api("/api/rooms", owner.cookie, jsonInit("POST", { name: "r" }));
  const { room } = (await createRes.json()) as { room: { id: string } };

  const startRes = await api(`/api/rooms/${room.id}/start`, intruder.cookie, jsonInit("POST", {}));
  expect(startRes.status).toBe(403);
});

test("시작하면 참여자 전원에게 자기 페르소나가 담긴 room-start가 간다", async () => {
  const owner = await createSessionUser(db, "owner5@example.com");
  const a1owner = await createSessionUser(db, "a1owner@example.com");
  const a2owner = await createSessionUser(db, "a2owner@example.com");
  const g1 = groups.create("g1");
  groups.grant(owner.id, g1.id);
  groups.grant(a1owner.id, g1.id);
  groups.grant(a2owner.id, g1.id);
  const agent1 = await registerAgent(a1owner.id, "agent-1");
  const agent2 = await registerAgent(a2owner.id, "agent-2");

  const createRes = await api("/api/rooms", owner.cookie, jsonInit("POST", { name: "토론방", context: "주제" }));
  const { room } = (await createRes.json()) as { room: { id: string } };

  await api(
    `/api/rooms/${room.id}/participants`,
    owner.cookie,
    jsonInit("POST", { agent_uuid: agent1.uuid, persona: "페르소나1" }),
  );
  await api(
    `/api/rooms/${room.id}/participants`,
    owner.cookie,
    jsonInit("POST", { agent_uuid: agent2.uuid, persona: "페르소나2" }),
  );

  const startRes = await api(`/api/rooms/${room.id}/start`, owner.cookie, jsonInit("POST", {}));
  expect(startRes.status).toBe(200);
  const { room: started1 } = (await startRes.json()) as { room: { status: string } };
  expect(started1.status).toBe("active");

  const frame1 = await agent1.nextFrame();
  expect(frame1).toMatchObject({
    type: "room-start",
    room: room.id,
    name: "토론방",
    context: "주제",
    persona: "페르소나1",
  });

  const frame2 = await agent2.nextFrame();
  expect(frame2).toMatchObject({ type: "room-start", room: room.id, persona: "페르소나2" });
});

test("draft가 아니면 배치가 거부된다", async () => {
  const owner = await createSessionUser(db, "owner6@example.com");
  const agentOwner = await createSessionUser(db, "agent-owner6@example.com");
  const g1 = groups.create("g1");
  groups.grant(owner.id, g1.id);
  groups.grant(agentOwner.id, g1.id);
  const agent = await registerAgent(agentOwner.id);

  const createRes = await api("/api/rooms", owner.cookie, jsonInit("POST", { name: "r" }));
  const { room } = (await createRes.json()) as { room: { id: string } };
  await api(`/api/rooms/${room.id}/start`, owner.cookie, jsonInit("POST", {}));

  const addRes = await api(
    `/api/rooms/${room.id}/participants`,
    owner.cookie,
    jsonInit("POST", { agent_uuid: agent.uuid }),
  );
  expect(addRes.status).toBe(400);
});

test("버튼 폭파 시 참여자·구독자에게 room-end가 가고 상태가 ended가 된다", async () => {
  const owner = await createSessionUser(db, "owner7@example.com");
  const a1owner = await createSessionUser(db, "a1owner7@example.com");
  const g1 = groups.create("g1");
  groups.grant(owner.id, g1.id);
  groups.grant(a1owner.id, g1.id);
  const agent1 = await registerAgent(a1owner.id, "agent-1");

  const createRes = await api("/api/rooms", owner.cookie, jsonInit("POST", { name: "폭파방" }));
  const { room } = (await createRes.json()) as { room: { id: string } };
  await api(`/api/rooms/${room.id}/participants`, owner.cookie, jsonInit("POST", { agent_uuid: agent1.uuid }));
  await api(`/api/rooms/${room.id}/start`, owner.cookie, jsonInit("POST", {}));
  await agent1.nextFrame(); // room-start 소비

  // register 엔드포인트로 웹 세션과 동일한 엔트리를 흉내내 구독자를 만든다.
  const webRes = await fetch(new URL("/register", started.server.url), {
    method: "POST",
    headers: { authorization: `Bearer ${await signToken(keys.privateKey, owner.id)}` },
    body: "{}",
  });
  if (webRes.body === null) throw new Error("no body");
  const reader = webRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  async function nextWebFrame(): Promise<Record<string, unknown>> {
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
  const webRegistered = await nextWebFrame();
  const webUuid = webRegistered.uuid as string;
  await api(`/api/rooms/${room.id}/watch`, owner.cookie, jsonInit("POST", { uuid: webUuid }));

  const endRes = await api(`/api/rooms/${room.id}/end`, owner.cookie, jsonInit("POST", {}));
  expect(endRes.status).toBe(200);
  const { room: ended } = (await endRes.json()) as { room: { status: string } };
  expect(ended.status).toBe("ended");

  const agentFrame = await agent1.nextFrame();
  expect(agentFrame).toEqual({ type: "room-end", room: room.id, name: "폭파방", sent_at: expect.any(String) });

  const webFrame = await nextWebFrame();
  expect(webFrame).toEqual({ type: "room-end", room: room.id, name: "폭파방", sent_at: expect.any(String) });
});

test("남의 room 폭파는 403이다", async () => {
  const owner = await createSessionUser(db, "owner8@example.com");
  const intruder = await createSessionUser(db, "intruder8@example.com");
  const createRes = await api("/api/rooms", owner.cookie, jsonInit("POST", { name: "r" }));
  const { room } = (await createRes.json()) as { room: { id: string } };

  const endRes = await api(`/api/rooms/${room.id}/end`, intruder.cookie, jsonInit("POST", {}));
  expect(endRes.status).toBe(403);
});

test("이미 ended인 room을 다시 폭파하면 400이다", async () => {
  const owner = await createSessionUser(db, "owner9@example.com");
  const createRes = await api("/api/rooms", owner.cookie, jsonInit("POST", { name: "r" }));
  const { room } = (await createRes.json()) as { room: { id: string } };
  await api(`/api/rooms/${room.id}/start`, owner.cookie, jsonInit("POST", {}));
  await api(`/api/rooms/${room.id}/end`, owner.cookie, jsonInit("POST", {}));

  const endRes = await api(`/api/rooms/${room.id}/end`, owner.cookie, jsonInit("POST", {}));
  expect(endRes.status).toBe(400);
});

function roomSend(body: unknown): Promise<Response> {
  return fetch(new URL("/room-send", started.server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function setUpActiveRoomWithMessages(messageCount: number) {
  const owner = await createSessionUser(db, `msg-owner-${crypto.randomUUID()}@example.com`);
  const agentOwner = await createSessionUser(db, `msg-agent-${crypto.randomUUID()}@example.com`);
  const g1 = groups.create(`g-${crypto.randomUUID()}`);
  groups.grant(owner.id, g1.id);
  groups.grant(agentOwner.id, g1.id);
  const agent = await registerAgent(agentOwner.id, "msg-agent");

  const createRes = await api("/api/rooms", owner.cookie, jsonInit("POST", { name: "기록방" }));
  const { room } = (await createRes.json()) as { room: { id: string } };
  await api(`/api/rooms/${room.id}/participants`, owner.cookie, jsonInit("POST", { agent_uuid: agent.uuid }));
  await api(`/api/rooms/${room.id}/start`, owner.cookie, jsonInit("POST", {}));
  await agent.nextFrame(); // room-start 소비

  for (let i = 0; i < messageCount; i++) {
    await roomSend({ from: agent.uuid, room: room.id, message: `발언${i}` });
  }

  return { owner, roomId: room.id, agent };
}

test("기록이 rowid 순으로 조회된다", async () => {
  const { owner, roomId } = await setUpActiveRoomWithMessages(3);

  const res = await api(`/api/rooms/${roomId}/messages`, owner.cookie);
  expect(res.status).toBe(200);
  const { messages } = (await res.json()) as { messages: { id: number; content: string }[] };
  expect(messages.map((m) => m.content)).toEqual(["발언0", "발언1", "발언2"]);
  expect(messages[0]?.id).toBeLessThan(messages[1] === undefined ? Number.POSITIVE_INFINITY : messages[1].id);
});

test("after 커서로 이어서 조회된다", async () => {
  const { owner, roomId } = await setUpActiveRoomWithMessages(3);

  const firstPage = await api(`/api/rooms/${roomId}/messages?limit=2`, owner.cookie);
  const { messages: firstMessages } = (await firstPage.json()) as { messages: { id: number; content: string }[] };
  expect(firstMessages.map((m) => m.content)).toEqual(["발언0", "발언1"]);

  const cursor = firstMessages[firstMessages.length - 1]?.id;
  const secondPage = await api(`/api/rooms/${roomId}/messages?after=${cursor}`, owner.cookie);
  const { messages: secondMessages } = (await secondPage.json()) as { messages: { id: number; content: string }[] };
  expect(secondMessages.map((m) => m.content)).toEqual(["발언2"]);
});

test("남의 room 기록은 403이다", async () => {
  const { roomId } = await setUpActiveRoomWithMessages(1);
  const intruder = await createSessionUser(db, "msg-intruder@example.com");

  const res = await api(`/api/rooms/${roomId}/messages`, intruder.cookie);
  expect(res.status).toBe(403);
});

test("ended room도 기록이 조회된다", async () => {
  const { owner, roomId } = await setUpActiveRoomWithMessages(2);
  await api(`/api/rooms/${roomId}/end`, owner.cookie, jsonInit("POST", {}));

  const res = await api(`/api/rooms/${roomId}/messages`, owner.cookie);
  expect(res.status).toBe(200);
  const { messages } = (await res.json()) as { messages: { content: string }[] };
  expect(messages.map((m) => m.content)).toEqual(["발언0", "발언1"]);
});

test("기록 조회 응답에 참여자 목록이 alias_snapshot과 함께 담긴다", async () => {
  const { owner, roomId } = await setUpActiveRoomWithMessages(1);

  const res = await api(`/api/rooms/${roomId}/messages`, owner.cookie);
  const { participants } = (await res.json()) as { participants: { alias_snapshot: string | null }[] };
  expect(participants).toEqual([expect.objectContaining({ alias_snapshot: "msg-agent" })]);
});
