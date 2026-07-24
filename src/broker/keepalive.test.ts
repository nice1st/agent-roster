import { expect, test } from "bun:test";
import { generateEs256KeyPair, signToken } from "../auth/keys";
import { createJwtVerifier } from "../auth/token";
import { startServer } from "../server";
import { KEEPALIVE_FRAME, sweepKeepalive } from "./keepalive";
import { type ConnectionHandle, Registry } from "./registry";

function collectingHandle(received: string[]): ConnectionHandle {
  return {
    send: (chunk) => {
      received.push(chunk);
    },
    close: () => {},
  };
}

test("sweep은 등록된 연결에 keepalive 주석 프레임을 push한다", () => {
  const registry = new Registry();
  const received: string[] = [];
  registry.register({ uuid: "a", owner: "u1", exposure: "follow", meta: {}, handle: collectingHandle(received) });
  sweepKeepalive(registry);
  expect(received).toEqual([KEEPALIVE_FRAME]);
});

test("keepalive push가 실패한 연결은 제거되고 나머지는 남는다", () => {
  const registry = new Registry();
  const dead: ConnectionHandle = {
    send: () => {
      throw new Error("stream closed");
    },
    close: () => {},
  };
  registry.register({ uuid: "dead", owner: "u1", exposure: "follow", meta: {}, handle: dead });
  registry.register({ uuid: "live", owner: "u1", exposure: "follow", meta: {}, handle: collectingHandle([]) });
  sweepKeepalive(registry);
  expect({ dead: registry.get("dead"), liveRemains: registry.get("live") !== undefined }).toEqual({
    dead: undefined,
    liveRemains: true,
  });
});

test("keepalive 주기마다 주석 프레임이 수신된다", async () => {
  const keys = await generateEs256KeyPair();
  const started = startServer({
    port: 0,
    verifier: createJwtVerifier(keys.publicKey),
    hygiene: { heartbeatIntervalMs: 20 },
  });
  try {
    const res = await fetch(new URL("/register", started.server.url), {
      method: "POST",
      headers: { authorization: `Bearer ${await signToken(keys.privateKey, "u1")}` },
      body: "{}",
    });
    if (res.body === null) throw new Error("no body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 2000;
    while (countKeepalives(buf) < 2 && Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    expect(countKeepalives(buf)).toBeGreaterThanOrEqual(2);
  } finally {
    started.server.stop(true);
  }
});

function countKeepalives(buf: string): number {
  return buf.split(KEEPALIVE_FRAME).length - 1;
}
