import { expect, test } from "bun:test";
import { toChannelText } from "./channel-text";

test("1:1 메시지 이벤트를 channel 태그 텍스트로 만든다", () => {
  const text = toChannelText({
    type: "message",
    from: "uuid-a",
    sent_at: "2026-07-31T00:00:00Z",
    message: "hello",
  });
  expect(text).toBe('<channel from_id="uuid-a" sent_at="2026-07-31T00:00:00Z">\nhello\n</channel>');
});

test("skill이 있으면 태그 속성으로 실린다", () => {
  const text = toChannelText({
    type: "message",
    from: "uuid-a",
    sent_at: "2026-07-31T00:00:00Z",
    message: "run it",
    skill: "plan",
  });
  expect(text).toContain('skill="plan"');
});

test("room 메시지는 room_id와 from_id를 함께 싣는다", () => {
  const text = toChannelText({
    type: "room-message",
    room: "room-1",
    from: "uuid-b",
    sent_at: "2026-07-31T00:00:00Z",
    message: "discuss",
  });
  expect(text).toBe('<channel room_id="room-1" from_id="uuid-b" sent_at="2026-07-31T00:00:00Z">\ndiscuss\n</channel>');
});

test("브로커 이벤트가 아니면 null을 준다", () => {
  expect(toChannelText({ type: "registered", uuid: "x" })).toBeNull();
  expect(toChannelText("garbage")).toBeNull();
});
