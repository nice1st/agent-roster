import { afterAll, expect, test } from "bun:test";
import { startServer } from "./server";

const server = startServer({ port: 0 });

afterAll(() => {
  server.stop(true);
});

test("서버를 띄우면 /health가 ok를 응답한다", async () => {
  const res = await fetch(new URL("/health", server.url));
  expect(await res.json()).toEqual({ ok: true });
});
