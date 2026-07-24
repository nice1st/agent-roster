// send_room 도구 동작 테스트(05 §2 #13) — 실서버(startServer)를 띄우고 실제 register → send_room을 태운다
// (broker-client.test.ts와 동일한 동작 테스트 규범, 05 §4). room을 active로 만들기 위해 rooms store를 직접 조작한다.
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Es256KeyPair, generateEs256KeyPair, signToken } from "../src/auth/keys";
import { createJwtVerifier } from "../src/auth/token";
import { createWebAuth, type WebAuth } from "../src/auth/web-auth";
import { startServer } from "../src/server";
import { runDomainMigrations } from "../src/store/migrations";
import { createRoomStore, type RoomStore } from "../src/store/rooms";
import { ENV_BROKER_TOKEN, ENV_BROKER_URL } from "./env";
import { handleRegister, handleSendRoom } from "./server";

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

function extractUuid(registeredText: string): string {
  const match = registeredText.match(/registered: (.+)/);
  if (match === null || match[1] === undefined) throw new Error(`unexpected register result: ${registeredText}`);
  return match[1];
}
