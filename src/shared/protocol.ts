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

export type BrokerEvent = RegisteredEvent | ErrorEvent;
