import { afterAll, expect, test } from "bun:test";
import { startServer } from "./server";

const denyAll = { verify: async () => null };
const { server } = startServer({ port: 0, verifier: denyAll });

afterAll(() => {
  server.stop(true);
});

test("서버를 띄우면 /health가 ok를 응답한다", async () => {
  const res = await fetch(new URL("/health", server.url));
  expect(await res.json()).toEqual({ ok: true });
});

test("인증 미구성 서버는 /api/auth가 404다", async () => {
  const res = await fetch(new URL("/api/auth/get-session", server.url));
  expect(res.status).toBe(404);
});
