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

export type BrokerEvent = RegisteredEvent | ErrorEvent | MessageEvent;
