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

test("room-start 이벤트는 room 소개·참가자 명단·자기 페르소나를 content에, room_id를 meta에 담는다", () => {
  const event = {
    type: "room-start",
    room: "room-1",
    name: "토론방",
    context: "주제",
    persona: "친절한 리뷰어",
    participants: [{ uuid: "agent-1", alias: "플래너" }, { uuid: "agent-2" }],
    sent_at: "2026-07-22T00:00:00.000Z",
  };
  const notification = toChannelNotification(event);
  expect(notification?.params.meta).toEqual({ room_id: "room-1", sent_at: "2026-07-22T00:00:00.000Z" });
  expect(notification?.params.content).toContain("토론방");
  expect(notification?.params.content).toContain("주제");
  expect(notification?.params.content).toContain("친절한 리뷰어");
  expect(notification?.params.content).toContain("참가자: 플래너, agent-2");
});

test("room-start 이벤트에 context·persona·참가자가 없으면 그 줄은 생략된다", () => {
  const event = {
    type: "room-start",
    room: "room-1",
    name: "토론방",
    participants: [],
    sent_at: "t",
  };
  const notification = toChannelNotification(event);
  expect(notification?.params.content).not.toContain("컨텍스트");
  expect(notification?.params.content).not.toContain("페르소나");
  expect(notification?.params.content).not.toContain("참가자");
});

test("room-message 이벤트를 content와 meta(room_id·from_id·sent_at)로 조립한다", () => {
  const event = {
    type: "room-message",
    room: "room-1",
    from: "agent-1",
    from_label: "agent-1-alias",
    sent_at: "2026-07-22T00:00:00.000Z",
    message: "발언 내용",
  };
  expect(toChannelNotification(event)).toEqual({
    method: "notifications/claude/channel",
    params: {
      content: "발언 내용",
      meta: { room_id: "room-1", from_id: "agent-1", sent_at: "2026-07-22T00:00:00.000Z" },
    },
  });
});

test("필수 필드가 빠진 room-message 이벤트는 null을 돌려준다", () => {
  expect(toChannelNotification({ type: "room-message", room: "room-1" })).toBeNull();
});
