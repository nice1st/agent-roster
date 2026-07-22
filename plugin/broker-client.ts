import type { AgentMeta } from "../src/broker/registry";
import { createSseParser } from "./sse";

export interface RegisterOptions {
  brokerUrl: string;
  token: string;
  uuid?: string;
  meta?: AgentMeta;
  onEvent?: (event: unknown) => void;
  onClose?: () => void;
}

export interface BrokerConnection {
  uuid: string;
  close(): void;
}

/** 브로커에 등록하고 registered 이벤트의 UUID를 받는다. 이후 스트림은 백그라운드로 계속 읽는다. */
export async function registerWithBroker(options: RegisterOptions): Promise<BrokerConnection> {
  const aborter = new AbortController();
  const res = await fetch(new URL("/register", options.brokerUrl), {
    method: "POST",
    signal: aborter.signal,
    headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
    body: JSON.stringify({ uuid: options.uuid, meta: options.meta }),
  });
  if (!res.ok || res.body === null) {
    const detail = await res.text().catch(() => "");
    throw new Error(`register failed: ${res.status} ${detail}`.trim());
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parse = createSseParser();

  // 첫 registered 프레임까지는 동기적으로 기다린다
  let uuid: string | undefined;
  const pending: unknown[] = [];
  while (uuid === undefined) {
    const { done, value } = await reader.read();
    if (done) throw new Error("stream closed before registered event");
    for (const event of parse(decoder.decode(value, { stream: true }))) {
      const e = event as { type?: string; uuid?: string; error?: string };
      if (e.type === "registered" && typeof e.uuid === "string") {
        uuid = e.uuid;
      } else if (e.type === "error") {
        throw new Error(`register rejected: ${e.error}`);
      } else {
        pending.push(event);
      }
    }
  }

  // 수신 루프 — 끊기면 onClose만 알린다. 재등록 여부·시점은 클라이언트 자율(04 §1).
  void (async () => {
    try {
      for (const event of pending) options.onEvent?.(event);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of parse(decoder.decode(value, { stream: true }))) options.onEvent?.(event);
      }
    } catch {
      // abort 또는 네트워크 종료
    }
    options.onClose?.();
  })();

  return { uuid, close: () => aborter.abort() };
}
