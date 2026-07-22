// SSE 스트림 증분 파서 — 주석 프레임(`: keepalive`)은 버리고 data 프레임의 JSON만 돌려준다.
// 청크 경계가 프레임 중간에 걸릴 수 있으므로 버퍼를 유지한다.
export function createSseParser(): (chunk: string) => unknown[] {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    const events: unknown[] = [];
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const rawFrame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of rawFrame.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            events.push(JSON.parse(line.slice("data: ".length)));
          } catch {
            // 손상된 프레임은 버린다
          }
        }
      }
      idx = buffer.indexOf("\n\n");
    }
    return events;
  };
}
