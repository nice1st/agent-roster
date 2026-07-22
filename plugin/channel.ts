import type { MessageEvent } from "../src/shared/protocol";

// 인바운드 message 이벤트 → notifications/claude/channel 페이로드 조립 (계승 형식).
// CC가 params.content와 params.meta 속성으로 <channel from_id=... sent_at=... skill=...> 태그를 조립한다 —
// content는 본문 그대로, 태그 속성은 meta로 싣는다(태그 문자열을 여기서 미리 감싸면 이중 래핑된다).

export interface ChannelNotification {
  method: "notifications/claude/channel";
  params: { content: string; meta: Record<string, string> };
}

/** message 이벤트만 알림으로 바꾼다 — 그 외 이벤트는 null. */
export function toChannelNotification(event: unknown): ChannelNotification | null {
  if (!isMessageEvent(event)) return null;
  const meta: Record<string, string> = { from_id: event.from, sent_at: event.sent_at };
  if (event.skill !== undefined) meta.skill = event.skill;
  return { method: "notifications/claude/channel", params: { content: event.message, meta } };
}

function isMessageEvent(event: unknown): event is MessageEvent {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Partial<MessageEvent>;
  return (
    e.type === "message" && typeof e.from === "string" && typeof e.sent_at === "string" && typeof e.message === "string"
  );
}
