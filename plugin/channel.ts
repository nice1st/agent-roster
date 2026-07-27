import type { MessageEvent, RoomEndEvent, RoomMessageEvent, RoomStartEvent } from "../src/shared/protocol";

// CC가 params.content와 params.meta 속성으로 <channel .../> 태그를 조립한다 — 여기서 태그를 미리 감싸면 이중 래핑된다.

export interface ChannelNotification {
  method: "notifications/claude/channel";
  params: { content: string; meta: Record<string, string> };
}

export function toChannelNotification(event: unknown): ChannelNotification | null {
  if (isMessageEvent(event)) return messageNotification(event);
  if (isRoomStartEvent(event)) return roomStartNotification(event);
  if (isRoomMessageEvent(event)) return roomMessageNotification(event);
  if (isRoomEndEvent(event)) return roomEndNotification(event);
  return null;
}

function messageNotification(event: MessageEvent): ChannelNotification {
  const meta: Record<string, string> = { from_id: event.from, sent_at: event.sent_at };
  if (event.skill !== undefined) meta.skill = event.skill;
  return { method: "notifications/claude/channel", params: { content: event.message, meta } };
}

function roomStartNotification(event: RoomStartEvent): ChannelNotification {
  const lines = [`room "${event.name}" 이(가) 시작됐다.`];
  if (event.context !== undefined) lines.push(`컨텍스트: ${event.context}`);
  if (event.persona !== undefined) lines.push(`당신의 페르소나: ${event.persona}`);
  const meta: Record<string, string> = { room_id: event.room, sent_at: event.sent_at };
  return { method: "notifications/claude/channel", params: { content: lines.join("\n"), meta } };
}

function roomMessageNotification(event: RoomMessageEvent): ChannelNotification {
  const meta: Record<string, string> = { room_id: event.room, from_id: event.from, sent_at: event.sent_at };
  return { method: "notifications/claude/channel", params: { content: event.message, meta } };
}

function roomEndNotification(event: RoomEndEvent): ChannelNotification {
  const meta: Record<string, string> = { room_id: event.room, sent_at: event.sent_at };
  return {
    method: "notifications/claude/channel",
    params: { content: `room "${event.name}" 이(가) 종료됐다. 더 이상 발언을 받지 않는다.`, meta },
  };
}

function isMessageEvent(event: unknown): event is MessageEvent {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Partial<MessageEvent>;
  return (
    e.type === "message" && typeof e.from === "string" && typeof e.sent_at === "string" && typeof e.message === "string"
  );
}

function isRoomStartEvent(event: unknown): event is RoomStartEvent {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Partial<RoomStartEvent>;
  return (
    e.type === "room-start" && typeof e.room === "string" && typeof e.name === "string" && typeof e.sent_at === "string"
  );
}

function isRoomMessageEvent(event: unknown): event is RoomMessageEvent {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Partial<RoomMessageEvent>;
  return (
    e.type === "room-message" &&
    typeof e.room === "string" &&
    typeof e.from === "string" &&
    typeof e.sent_at === "string" &&
    typeof e.message === "string"
  );
}

function isRoomEndEvent(event: unknown): event is RoomEndEvent {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Partial<RoomEndEvent>;
  return (
    e.type === "room-end" && typeof e.room === "string" && typeof e.name === "string" && typeof e.sent_at === "string"
  );
}
