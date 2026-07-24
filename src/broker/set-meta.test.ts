// set-meta 동작 테스트 — 05 §2 #9, 실서버 port 0(05 §4 테스트 규범).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Es256KeyPair, generateEs256KeyPair, signToken } from "../auth/keys";
import { createJwtVerifier } from "../auth/token";
import { startServer } from "../server";

let keys: Es256KeyPair;
let started: ReturnType<typeof startServer>;

beforeAll(async () => {
  keys = await generateEs256KeyPair();
  started = startServer({ port: 0, verifier: createJwtVerifier(keys.publicKey) });
});

afterAll(() => {
  started.server.stop(true);
});

async function registerAgent(userId: string, meta: Record<string, string> = {}): Promise<string> {
  const res = await fetch(new URL("/register", started.server.url), {
    method: "POST",
    headers: { authorization: `Bearer ${await signToken(keys.privateKey, userId)}` },
    body: JSON.stringify({ meta }),
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

function setMeta(body: unknown): Promise<Response> {
  return fetch(new URL("/set-meta", started.server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("set_meta로 status를 바꾸면 peers 응답에 반영된다", async () => {
  // 이 서버는 groupsDeps 없이 뜨므로 /peers는 마운트되지 않는다 — 반영 확인은 registry 직접 조회로 한다.
  const a1 = await registerAgent("u1", { alias: "a1" });
  await setMeta({ from: a1, status: "busy" });
  expect(started.registry.get(a1)?.meta).toEqual({ alias: "a1", status: "busy" });
});

test("일부 필드만 줘도 나머지 meta는 유지된다", async () => {
  const a1 = await registerAgent("u1", { alias: "keep-me", status: "idle" });
  await setMeta({ from: a1, status: "busy" });
  expect(started.registry.get(a1)?.meta).toEqual({ alias: "keep-me", status: "busy" });
});

test("미등록 from은 Peer not found", async () => {
  const res = await setMeta({ from: crypto.randomUUID(), status: "busy" });
  expect(await res.json()).toEqual({ ok: false, error: "Peer not found" });
});

test("alias·status가 문자열이 아니면 400", async () => {
  const a1 = await registerAgent("u1");
  const res = await setMeta({ from: a1, status: 123 });
  expect(res.status).toBe(400);
});
