import type { MessageEvent, RoomMessageEvent, RoomStartEvent } from "../src/shared/protocol";

// 인바운드 이벤트 → notifications/claude/channel 페이로드 조립 (message는 계승 형식, room-start·room-message는
// 05 §2 #13 신규). CC가 params.content와 params.meta 속성으로 <channel .../> 태그를 조립한다 —
// content는 본문 그대로, 태그 속성은 meta로 싣는다(태그 문자열을 여기서 미리 감싸면 이중 래핑된다).

export interface ChannelNotification {
  method: "notifications/claude/channel";
  params: { content: string; meta: Record<string, string> };
}

/** message·room-start·room-message 이벤트만 알림으로 바꾼다 — 그 외 이벤트는 null. */
export function toChannelNotification(event: unknown): ChannelNotification | null {
  if (isMessageEvent(event)) return messageNotification(event);
  if (isRoomStartEvent(event)) return roomStartNotification(event);
  if (isRoomMessageEvent(event)) return roomMessageNotification(event);
  return null;
}

function messageNotification(event: MessageEvent): ChannelNotification {
  const meta: Record<string, string> = { from_id: event.from, sent_at: event.sent_at };
  if (event.skill !== undefined) meta.skill = event.skill;
  return { method: "notifications/claude/channel", params: { content: event.message, meta } };
}

/** room-start의 content는 room 소개(이름·컨텍스트) + 수신자 자신의 페르소나 텍스트(01 §5). */
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
