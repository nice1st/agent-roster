import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ENV_BROKER_TOKEN, ENV_BROKER_URL } from "../client-core/env";
import { type Es256KeyPair, generateEs256KeyPair, signToken } from "../src/auth/keys";
import { createJwtVerifier } from "../src/auth/token";
import { createWebAuth, type WebAuth } from "../src/auth/web-auth";
import { startServer } from "../src/server";
import { runDomainMigrations } from "../src/store/migrations";
import { createRoomStore, type RoomStore } from "../src/store/rooms";
import { handleRegister, handleSendRoom, handleUnregister } from "./server";

const TEST_SECRET = "test-only-secret-plugin-send-room";

let db: Database;
let webAuth: WebAuth;
let rooms: RoomStore;
let keys: Es256KeyPair;
let started: ReturnType<typeof startServer>;
let originalBrokerUrl: string | undefined;
let originalBrokerToken: string | undefined;

beforeEach(async () => {
  db = new Database(":memory:");
  keys = await generateEs256KeyPair();
  webAuth = createWebAuth({ db, secret: TEST_SECRET, baseURL: "http://localhost" });
  await webAuth.runMigrations();
  runDomainMigrations(db);
  rooms = createRoomStore(db);
  started = startServer({
    port: 0,
    verifier: createJwtVerifier(keys.publicKey),
    webAuth,
    roomsDeps: { webAuth, rooms, getUserGroups: () => [] },
  });
  originalBrokerUrl = process.env[ENV_BROKER_URL];
  originalBrokerToken = process.env[ENV_BROKER_TOKEN];
  process.env[ENV_BROKER_URL] = started.server.url.href;
});

afterEach(() => {
  started.server.stop(true);
  if (originalBrokerUrl === undefined) delete process.env[ENV_BROKER_URL];
  else process.env[ENV_BROKER_URL] = originalBrokerUrl;
  if (originalBrokerToken === undefined) delete process.env[ENV_BROKER_TOKEN];
  else process.env[ENV_BROKER_TOKEN] = originalBrokerToken;
});

function activeRoom(): { id: string } {
  const room = rooms.create("owner-1", "토론방", undefined, 0);
  rooms.start(room.id);
  return room;
}

test('미등록 상태 unregister는 "Not registered."를 반환한다', () => {
  // 모듈 전역 connection이 아직 null인 최초 테스트여야 한다 — 순서를 옮기지 말 것
  const result = handleUnregister();
  expect(result.isError).toBeUndefined();
  expect(result.content[0]?.text).toBe("Not registered.");
});

test("room_id·message가 없으면 에러를 돌려준다", async () => {
  const result = await handleSendRoom({});
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("required");
});

test("active room에 발언하면 Delivered 메시지를 돌려주고 기록된다", async () => {
  process.env[ENV_BROKER_TOKEN] = await signToken(keys.privateKey, "u2");
  const registerResult = await handleRegister({ alias: "plugin-agent" });
  expect(registerResult.isError).toBeUndefined();
  const room = activeRoom();
  rooms.addParticipant(room.id, extractUuid(registerResult.content[0]?.text ?? ""), undefined, undefined, undefined);

  const result = await handleSendRoom({ room_id: room.id, message: "플러그인에서 보낸 발언" });
  expect(result.isError).toBeUndefined();
  expect(result.content[0]?.text).toBe(`Delivered to room ${room.id}.`);

  const stored = rooms.listMessages(room.id);
  expect(stored.at(-1)).toMatchObject({ content: "플러그인에서 보낸 발언", from_label: "plugin-agent" });
});

test("active가 아닌 room에 발언하면 거부 메시지를 돌려준다", async () => {
  process.env[ENV_BROKER_TOKEN] = await signToken(keys.privateKey, "u3");
  await handleRegister({});
  const room = rooms.create("owner-2", "draft방", undefined, 0); // start 하지 않음 — 여전히 draft

  const result = await handleSendRoom({ room_id: room.id, message: "아직 시작 전" });
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("Room not active");
});

test("env 없이 register를 부르면 빠진 변수명이 담긴 안내가 나온다", async () => {
  delete process.env[ENV_BROKER_URL];
  delete process.env[ENV_BROKER_TOKEN];

  const result = await handleRegister({});

  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toBe(
    `${ENV_BROKER_URL}, ${ENV_BROKER_TOKEN} 환경변수가 필요하다 — CC를 띄운 셸에 export 후 재시작`,
  );
});

test("아무도 안 듣는 포트로 향한 register 호출은 연결할 수 없다 형식으로 응답한다", async () => {
  process.env[ENV_BROKER_URL] = "http://127.0.0.1:1";
  process.env[ENV_BROKER_TOKEN] = await signToken(keys.privateKey, "u4");

  const result = await handleRegister({});

  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("브로커(http://127.0.0.1:1)에 연결할 수 없다");
  expect(result.content[0]?.text).toContain("브로커 기동 여부를 확인하라");
});

test("unregister가 연결을 닫고 storedUuid는 유지한다 — 재register 시 같은 uuid로 복귀한다", async () => {
  process.env[ENV_BROKER_TOKEN] = await signToken(keys.privateKey, "u-unreg-resume");
  const registerResult = await handleRegister({});
  const uuid = extractUuid(registerResult.content[0]?.text ?? "");

  const unregisterResult = handleUnregister();
  expect(unregisterResult.isError).toBeUndefined();
  expect(unregisterResult.content[0]?.text).toBe(`unregistered: ${uuid}`);

  process.env[ENV_BROKER_TOKEN] = await signToken(keys.privateKey, "u-unreg-resume");
  const resumeResult = await handleRegister({});
  expect(resumeResult.isError).toBeUndefined();
  expect(extractUuid(resumeResult.content[0]?.text ?? "")).toBe(uuid);
});

test("unregister에 의한 close에서는 끊김 알림이 발화되지 않는다", async () => {
  process.env[ENV_BROKER_TOKEN] = await signToken(keys.privateKey, "u-unreg-notify");
  await handleRegister({});
  await Bun.sleep(50); // 이전 테스트의 leftover connection이 지금 닫히며 보내는 알림을 흘려보낸다

  const notifications: unknown[] = [];
  const spy = spyOn(Server.prototype, "notification").mockImplementation(async (n: unknown) => {
    notifications.push(n);
    return undefined;
  });

  try {
    handleUnregister();
    await Bun.sleep(100);

    const disconnectNotifications = notifications.filter((n) => {
      const content = (n as { params?: { content?: string } }).params?.content;
      return typeof content === "string" && content.includes("연결이 끊겼다");
    });
    expect(disconnectNotifications).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});

function extractUuid(registeredText: string): string {
  const match = registeredText.match(/registered: (.+)/);
  if (match === null || match[1] === undefined) throw new Error(`unexpected register result: ${registeredText}`);
  return match[1];
}
