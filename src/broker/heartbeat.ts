// 앱 전체 인터벌 1개(05 §4 스케줄 결정) — 순찰 작업(keepalive·room 만료 스위프·이후 추가분)을 목록으로 등록해
// 매 tick마다 순서대로 돌린다. 인터벌 증식을 구조적으로 막는다: setInterval은 이 파일에만 존재해야 한다.

/** 등록된 작업을 매 tick마다 순서대로 실행한다 — 한 작업의 예외가 다른 작업 실행을 막지 않는다(작업별 try/catch). */
export function runHeartbeatTasks(tasks: Array<() => void>): void {
  for (const task of tasks) {
    try {
      task();
    } catch (e) {
      console.error("heartbeat task failed:", e instanceof Error ? e.message : String(e));
    }
  }
}

/** 주기 하트비트를 시작한다 — 타이머는 unref로 프로세스 종료를 막지 않는다. */
export function startHeartbeat(intervalMs: number, tasks: Array<() => void>): Timer {
  const timer = setInterval(() => runHeartbeatTasks(tasks), intervalMs);
  timer.unref();
  return timer;
}
