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
  sent_at: string;
  message: string;
  skill?: string;
}

// persona는 수신자 자신의 것 — 참여자별 개별 프레임으로 나간다.
export interface RoomStartEvent {
  type: "room-start";
  room: string;
  name: string;
  context?: string;
  persona?: string;
  participants: { uuid: string; alias?: string }[];
  sent_at: string;
}

export interface RoomMessageEvent {
  type: "room-message";
  room: string;
  from: string;
  from_label?: string;
  sent_at: string;
  message: string;
}

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
