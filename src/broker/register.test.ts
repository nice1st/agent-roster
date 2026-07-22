import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Es256KeyPair, generateEs256KeyPair, signToken } from "../auth/keys";
import { createJwtVerifier } from "../auth/token";
import { startServer } from "../server";

let keys: Es256KeyPair;
let otherKeys: Es256KeyPair;
let started: ReturnType<typeof startServer>;

beforeAll(async () => {
  keys = await generateEs256KeyPair();
  otherKeys = await generateEs256KeyPair();
  started = startServer({ port: 0, verifier: createJwtVerifier(keys.publicKey) });
});

afterAll(() => {
  started.server.stop(true);
});

function register(token: string, body: object = {}, signal?: AbortSignal): Promise<Response> {
  return fetch(new URL("/register", started.server.url), {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

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
  const frame: { type: string; uuid?: string } = JSON.parse(buf.slice("data: ".length, buf.indexOf("\n\n")));
  return { frame, reader };
}

test("유효한 토큰으로 regi하면 registered 이벤트로 UUID를 받는다", async () => {
  const res = await register(await signToken(keys.privateKey, "u1"));
  const { frame } = await readFirstFrame(res);
  expect(frame).toEqual({ type: "registered", uuid: expect.any(String) });
});

test("다른 키로 서명된 토큰은 401", async () => {
  const res = await register(await signToken(otherKeys.privateKey, "u1"));
  expect(res.status).toBe(401);
});

test("만료된 토큰은 401", async () => {
  const res = await register(await signToken(keys.privateKey, "u1", -60));
  expect(res.status).toBe(401);
});

test("같은 user가 같은 uuid로 리쥼하면 같은 UUID로 응답한다", async () => {
  const token = await signToken(keys.privateKey, "u1");
  const first = await readFirstFrame(await register(token));
  const second = await readFirstFrame(await register(token, { uuid: first.frame.uuid }));
  expect(second.frame.uuid).toBe(first.frame.uuid as string);
});

test("리쥼하면 구 연결이 닫힌다", async () => {
  const token = await signToken(keys.privateKey, "u1");
  const first = await readFirstFrame(await register(token));
  await readFirstFrame(await register(token, { uuid: first.frame.uuid }));
  expect((await first.reader.read()).done).toBe(true);
});

test("다른 user가 남의 uuid로 리쥼하면 403", async () => {
  const first = await readFirstFrame(await register(await signToken(keys.privateKey, "u1")));
  const res = await register(await signToken(keys.privateKey, "u2"), { uuid: first.frame.uuid });
  expect(res.status).toBe(403);
});

test("레지스트리에 없는 uuid로 리쥼하면 그 uuid로 등재된다", async () => {
  const wanted = crypto.randomUUID();
  const { frame } = await readFirstFrame(await register(await signToken(keys.privateKey, "u1"), { uuid: wanted }));
  expect(frame.uuid).toBe(wanted);
});

test("연결을 끊으면 엔트리가 제거된다", async () => {
  const before = started.registry.size;
  const aborter = new AbortController();
  const res = await register(await signToken(keys.privateKey, "u1"), {}, aborter.signal);
  await readFirstFrame(res);
  aborter.abort();
  const deadline = Date.now() + 2000;
  while (started.registry.size !== before && Date.now() < deadline) {
    await Bun.sleep(10);
  }
  expect(started.registry.size).toBe(before);
});
