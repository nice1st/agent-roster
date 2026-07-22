import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Es256KeyPair, generateEs256KeyPair, signToken } from "../src/auth/keys";
import { createJwtVerifier } from "../src/auth/token";
import { startServer } from "../src/server";
import { registerWithBroker } from "./broker-client";

let keys: Es256KeyPair;
let started: ReturnType<typeof startServer>;
let brokerUrl: string;

beforeAll(async () => {
  keys = await generateEs256KeyPair();
  started = startServer({ port: 0, verifier: createJwtVerifier(keys.publicKey) });
  brokerUrl = started.server.url.href;
});

afterAll(() => {
  started.server.stop(true);
});

test("등록하면 브로커가 발급한 UUID를 받는다", async () => {
  const token = await signToken(keys.privateKey, "u1");
  const conn = await registerWithBroker({ brokerUrl, token });
  expect(conn.uuid).toMatch(/^[0-9a-f-]{36}$/);
  conn.close();
});

test("보관한 UUID로 재등록하면 같은 UUID로 복귀한다", async () => {
  const token = await signToken(keys.privateKey, "u1");
  const first = await registerWithBroker({ brokerUrl, token });
  const second = await registerWithBroker({ brokerUrl, token, uuid: first.uuid });
  expect(second.uuid).toBe(first.uuid);
  second.close();
});

test("남의 uuid로 등록하면 예외를 던진다", async () => {
  const first = await registerWithBroker({ brokerUrl, token: await signToken(keys.privateKey, "u1") });
  const other = await signToken(keys.privateKey, "u2");
  expect(registerWithBroker({ brokerUrl, token: other, uuid: first.uuid })).rejects.toThrow("403");
  first.close();
});
