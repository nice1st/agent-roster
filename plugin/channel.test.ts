import { expect, test } from "bun:test";
import { toChannelNotification } from "./channel";

test("message 이벤트를 content와 meta(from_id·sent_at)로 조립한다", () => {
  const event = { type: "message", from: "agent-1", sent_at: "2026-07-22T00:00:00.000Z", message: "hello" };
  expect(toChannelNotification(event)).toEqual({
    method: "notifications/claude/channel",
    params: { content: "hello", meta: { from_id: "agent-1", sent_at: "2026-07-22T00:00:00.000Z" } },
  });
});

test("skill이 있으면 meta에 skill이 포함된다", () => {
  const event = { type: "message", from: "agent-1", sent_at: "t", message: "hello", skill: "review" };
  expect(toChannelNotification(event)?.params.meta.skill).toBe("review");
});

test("message가 아닌 이벤트는 null을 돌려준다", () => {
  expect(toChannelNotification({ type: "registered", uuid: "agent-1" })).toBeNull();
});

test("필수 필드가 빠진 message 이벤트는 null을 돌려준다", () => {
  expect(toChannelNotification({ type: "message", message: "hello" })).toBeNull();
});
