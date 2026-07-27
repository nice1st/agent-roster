import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Es256KeyPair, generateEs256KeyPair, signToken } from "../auth/keys";
import { createJwtVerifier } from "../auth/token";
import { startServer } from "../server";
import { Registry } from "./registry";
import { createSendHandler } from "./send";

let keys: Es256KeyPair;
let started: ReturnType<typeof startServer>;

beforeAll(async () => {
  keys = await generateEs256KeyPair();
  started = startServer({ port: 0, verifier: createJwtVerifier(keys.publicKey) });
});

afterAll(() => {
  started.server.stop(true);
});

async function registerReceiver(userId: string, signal?: AbortSignal) {
  const res = await fetch(new URL("/register", started.server.url), {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${await signToken(keys.privateKey, userId)}` },
    body: "{}",
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

function send(body: unknown): Promise<Response> {
  return fetch(new URL("/send", started.server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("등록된 상대에게 보내면 ok true를 받는다", async () => {
  const receiver = await registerReceiver("u1");
  const res = await send({ from: crypto.randomUUID(), to: receiver.uuid, message: "hello" });
  expect(await res.json()).toEqual({ ok: true });
});

test("등록된 상대의 스트림에 from·sent_at·message가 실린 message 프레임이 도착한다", async () => {
  const receiver = await registerReceiver("u1");
  const from = crypto.randomUUID();
  await send({ from, to: receiver.uuid, message: "hello" });
  expect(await receiver.nextFrame()).toEqual({ type: "message", from, sent_at: expect.any(String), message: "hello" });
});

test("skill을 실으면 수신 프레임에 skill이 포함된다", async () => {
  const receiver = await registerReceiver("u1");
  await send({ from: crypto.randomUUID(), to: receiver.uuid, message: "hello", skill: "review" });
  expect((await receiver.nextFrame()).skill).toBe("review");
});

test("레지스트리에 없는 대상이면 200과 ok false Peer not found로 응답한다", async () => {
  const res = await send({ from: crypto.randomUUID(), to: crypto.randomUUID(), message: "hello" });
  expect({ status: res.status, body: await res.json() }).toEqual({
    status: 200,
    body: { ok: false, error: "Peer not found" },
  });
});

test("연결을 끊은 대상에게 보내면 Peer not found를 받는다", async () => {
  const aborter = new AbortController();
  const receiver = await registerReceiver("u1", aborter.signal);
  aborter.abort();
  const deadline = Date.now() + 2000;
  while (started.registry.get(receiver.uuid) !== undefined && Date.now() < deadline) {
    await Bun.sleep(10);
  }
  const res = await send({ from: crypto.randomUUID(), to: receiver.uuid, message: "hello" });
  expect(await res.json()).toEqual({ ok: false, error: "Peer not found" });
});

test("필수 필드가 빠지면 400", async () => {
  const res = await send({ from: crypto.randomUUID(), to: crypto.randomUUID() });
  expect(res.status).toBe(400);
});

test("push가 실패하면 엔트리를 제거하고 Peer not found로 응답한다", async () => {
  const registry = new Registry();
  const handle = {
    send: () => {
      throw new Error("stream closed");
    },
    close: () => {},
  };
  registry.register({ uuid: "dead-peer", owner: "u1", exposure: "follow", meta: {}, handle });
  const handler = createSendHandler({ registry });
  const res = await handler(
    new Request("http://broker/send", {
      method: "POST",
      body: JSON.stringify({ from: "sender", to: "dead-peer", message: "hello" }),
    }),
  );
  expect({ body: await res.json(), removed: registry.get("dead-peer") === undefined }).toEqual({
    body: { ok: false, error: "Peer not found" },
    removed: true,
  });
});
