// 브로커 SSE 프레임의 data 페이로드 — 브로커와 플러그인이 공유하는 이음새.
// 계승 형식: event: 필드 없이 data의 type으로 구분한다.

export interface RegisteredEvent {
  type: "registered";
  uuid: string;
}

export interface ErrorEvent {
  type: "error";
  error: string;
}

export interface MessageEvent {
  type: "message";
  from: string;
  sent_at: string; // 브로커가 릴레이 시점에 찍는 ISO8601
  message: string;
  skill?: string; // 발신 요청에 있을 때만 포함
}

// room 시작 팬아웃(05 §2 #12) — persona는 수신자 자신의 것이라 참여자별 개별 프레임으로 나간다.
export interface RoomStartEvent {
  type: "room-start";
  room: string;
  name: string;
  context?: string;
  persona?: string;
  participants: { uuid: string; alias?: string }[];
  sent_at: string;
}

// room 발언 팬아웃(05 §2 #13) — from_label은 발신 시점 레지스트리 alias(웹이면 email alias 그대로).
export interface RoomMessageEvent {
  type: "room-message";
  room: string;
  from: string;
  from_label?: string;
  sent_at: string;
  message: string;
}

// room 종료(폭파) 팬아웃(05 §2 #14) — 버튼 폭파·만료 스위프가 같은 프레임을 낸다(05 §4 room 종료 처리).
export interface RoomEndEvent {
  type: "room-end";
  room: string;
  name: string;
  sent_at: string;
}

export type BrokerEvent =
  | RegisteredEvent
  | ErrorEvent
  | MessageEvent
  | RoomStartEvent
  | RoomMessageEvent
  | RoomEndEvent;
