import type { Registry } from "./registry";

// keepalive 주석 프레임(계승 형식) — 주기 push로 죽은 연결을 감지한다. 감지 지연은 주기만큼(02 §5).
export const KEEPALIVE_FRAME = ": keepalive\n\n";

/** 전 연결에 keepalive를 1회 push한다 — push가 던지는 연결은 죽은 것으로 보고 제거한다(계승 패턴).
 * 하트비트 작업으로 등록된다(src/broker/heartbeat.ts) — 이 함수 자체는 스위프 동작만 하고 스케줄은 갖지 않는다. */
export function sweepKeepalive(registry: Registry): void {
  for (const entry of registry.values()) {
    try {
      entry.handle.send(KEEPALIVE_FRAME);
    } catch {
      registry.removeIfCurrent(entry.uuid, entry.handle);
    }
  }
}
