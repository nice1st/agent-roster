import { expect, test } from "bun:test";
import type { ConnectionHandle } from "./registry";
import { createSseConnection } from "./sse";

test("소비자가 cancel하면 onCancel이 그 연결의 핸들로 불린다", async () => {
  const seen: ConnectionHandle[] = [];
  const { stream, handle } = createSseConnection({ onCancel: (h) => seen.push(h) });
  await stream.cancel();
  expect(seen).toEqual([handle]);
});
