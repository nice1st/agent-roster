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
