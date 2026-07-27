// 앱 전체 인터벌은 이 파일의 하나뿐이다 — 새 주기 작업은 setInterval을 추가하지 말고 하트비트 작업으로 등록한다.

export function runHeartbeatTasks(tasks: Array<() => void>): void {
  for (const task of tasks) {
    try {
      task();
    } catch (e) {
      console.error("heartbeat task failed:", e instanceof Error ? e.message : String(e));
    }
  }
}

export function startHeartbeat(intervalMs: number, tasks: Array<() => void>): Timer {
  const timer = setInterval(() => runHeartbeatTasks(tasks), intervalMs);
  timer.unref();
  return timer;
}
