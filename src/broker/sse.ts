// SSE 프레임 직렬화 — 계승 형식: event: 필드 없이 data의 type으로 구분.
export function sseFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}
