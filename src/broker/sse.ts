import type { ConnectionHandle } from "./registry";

// SSE 프레임 직렬화 — 계승 형식: event: 필드 없이 data의 type으로 구분.
export function sseFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

const encoder = new TextEncoder();

export interface SseConnectionOptions {
  onCancel: (handle: ConnectionHandle) => void;
}

// 미전송 큐 상한은 두지 않는다 — Bun이 소켓 backpressure를 유저스페이스에 전파하지 않아
// 밀린 양을 측정할 수 없다(02 §3 실행 검증). 죽은 연결은 keepalive 실패·cancel로 회수된다.
export function createSseConnection(options: SseConnectionOptions): {
  stream: ReadableStream<Uint8Array>;
  handle: ConnectionHandle;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const handle: ConnectionHandle = {
    send: (chunk) => {
      controller.enqueue(encoder.encode(chunk));
    },
    close: () => {
      try {
        controller.close();
      } catch {
        // 이미 닫혔거나 에러난 스트림 — 무시
      }
    },
  };
  const stream = new ReadableStream<Uint8Array>({
    // start는 생성 시점에 동기 실행된다 — 반환 직후부터 handle을 쓸 수 있다
    start: (c) => {
      controller = c;
    },
    cancel: () => {
      options.onCancel(handle);
    },
  });
  return { stream, handle };
}
