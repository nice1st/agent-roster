import type { ConnectionHandle } from "./registry";

// event: 필드 없이 data만 쓴다 — 웹 EventSource가 기본 message 이벤트로 받는 전제.
export function sseFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

const encoder = new TextEncoder();

export interface SseConnectionOptions {
  onCancel: (handle: ConnectionHandle) => void;
}

// 미전송 큐 상한은 두지 않는다 — Bun이 소켓 backpressure를 유저스페이스에 전파하지 않아 밀린 양을 측정할 수 없다.
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
