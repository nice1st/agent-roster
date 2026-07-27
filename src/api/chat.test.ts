import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { createWebAuth, type WebAuth } from "../auth/web-auth";
import { startServer } from "../server";
import { createGroupStore, type GroupStore } from "../store/groups";
import { runDomainMigrations } from "../store/migrations";

const TEST_SECRET = "test-only-secret-chat-api";

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
let started: ReturnType<typeof startServer>;

beforeEach(async () => {
  db = new Database(":memory:");
  webAuth = createWebAuth({ db, secret: TEST_SECRET, baseURL: "http://localhost" });
  await webAuth.runMigrations();
  runDomainMigrations(db);
  groups = createGroupStore(db);
  started = startServer({
    port: 0,
    // 이 스위트는 브로커 JWT(/register)를 쓰지 않으므로 검증기는 항상 거부해도 무방하다.
    verifier: { verify: async () => null },
    webAuth,
    groupsDeps: { getUserGroups: (userId) => groups.getGroupsForUser(userId) },
    chatDeps: { webAuth },
  });
});

afterEach(() => {
  started.server.stop(true);
});

async function readFirstFrame(res: Response) {
  if (res.body === null) throw new Error("no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (!buf.includes("\n\n")) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`stream ended without frame: ${buf}`);
    buf += decoder.decode(value, { stream: true });
  }
  const frame: { type: string; uuid?: string; error?: string } = JSON.parse(
    buf.slice("data: ".length, buf.indexOf("\n\n")),
  );
  return { frame, reader };
}

function chatStream(cookie?: string, uuid?: string, signal?: AbortSignal): Promise<Response> {
  const url = new URL("/api/chat/stream", started.server.url);
  if (uuid !== undefined) url.searchParams.set("uuid", uuid);
  return fetch(url, { signal, headers: cookie === undefined ? undefined : { cookie } });
}

test("세션 없는 스트림 요청은 401이다", async () => {
  const res = await chatStream();
  expect(res.status).toBe(401);
});

test("스트림을 열면 registered 프레임이 오고 그 엔트리는 어떤 peers에도 보이지 않는다", async () => {
  const user = await createSessionUser(db, "web-user@example.com");
  const g1 = groups.create("g1");
  groups.grant(user.id, g1.id);

  const res = await chatStream(user.cookie);
  const { frame } = await readFirstFrame(res);
  expect(frame.type).toBe("registered");
  expect(typeof frame.uuid).toBe("string");

  const peersRes = await fetch(new URL("/peers", started.server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: frame.uuid }),
  });
  const peersBody = (await peersRes.json()) as { peers: { uuid: string }[] };
  expect(peersBody.peers.map((p) => p.uuid)).not.toContain(frame.uuid);
});

test("다른 user의 세션으로 남의 uuid 리쥼은 거부된다", async () => {
  const owner = await createSessionUser(db, "owner@example.com");
  const intruder = await createSessionUser(db, "intruder@example.com");

  const first = await readFirstFrame(await chatStream(owner.cookie));
  const res = await chatStream(intruder.cookie, first.frame.uuid);
  expect(res.status).toBe(403);
});

test("웹 uuid로 보낸 메시지가 상대에게 도착하고 상대가 보낸 메시지가 스트림에 도착한다", async () => {
  const webUser = await createSessionUser(db, "chat-user@example.com");
  const webStream = await readFirstFrame(await chatStream(webUser.cookie));
  const webUuid = webStream.frame.uuid as string;

  const peerUser = await createSessionUser(db, "peer-user@example.com");
  const peerStream = await readFirstFrame(await chatStream(peerUser.cookie));
  const peerUuid = peerStream.frame.uuid as string;

  const sendRes = await fetch(new URL("/send", started.server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: webUuid, to: peerUuid, message: "hello from web" }),
  });
  expect(await sendRes.json()).toEqual({ ok: true });

  const { done, value } = await peerStream.reader.read();
  expect(done).toBe(false);
  const decoded = new TextDecoder().decode(value);
  const received = JSON.parse(decoded.slice("data: ".length, decoded.indexOf("\n\n"))) as {
    type: string;
    from: string;
    message: string;
    sent_at: string;
  };
  expect(received).toEqual({ type: "message", from: webUuid, message: "hello from web", sent_at: expect.any(String) });

  const replyRes = await fetch(new URL("/send", started.server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: peerUuid, to: webUuid, message: "hello back" }),
  });
  expect(await replyRes.json()).toEqual({ ok: true });

  const webRead = await webStream.reader.read();
  expect(webRead.done).toBe(false);
  const webDecoded = new TextDecoder().decode(webRead.value);
  const webReceived = JSON.parse(webDecoded.slice("data: ".length, webDecoded.indexOf("\n\n"))) as {
    type: string;
    from: string;
    message: string;
    sent_at: string;
  };
  expect(webReceived).toEqual({ type: "message", from: peerUuid, message: "hello back", sent_at: expect.any(String) });
});
