import type { ConnectionState } from "./broker-stream";
import { senderColor } from "./sender-color";
import { useStickToBottom } from "./use-stick-to-bottom";

export interface ChatLogMessage {
  id?: number;
  from: string;
  message: string;
}

export interface ChatLogProps<M extends ChatLogMessage> {
  messages: M[];
  myUuid: string | null;
  labelOf(message: M): string;
}

export function ChatLog<M extends ChatLogMessage>({ messages, myUuid, labelOf }: ChatLogProps<M>) {
  const { logRef, onScroll } = useStickToBottom(messages);

  return (
    <ul role="log" ref={logRef} onScroll={onScroll} className="chat-log">
      {messages.map((m, i) => {
        const grouped = i > 0 && messages[i - 1]?.from === m.from;
        return (
          <li key={m.id ?? `stream-${i}`} style={{ marginTop: grouped ? "0.125rem" : "0.75rem" }}>
            {!grouped && (
              <strong style={{ color: senderColor(m.from) }}>{m.from === myUuid ? "me" : labelOf(m)}</strong>
            )}
            <span style={{ whiteSpace: "pre-wrap", display: "block" }}>{m.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

export interface ConnectionBannerProps {
  connectionState: ConnectionState;
  onReconnect(): void;
}

export function ConnectionBanner({ connectionState, onReconnect }: ConnectionBannerProps) {
  if (connectionState === "disconnected") {
    return (
      <p role="alert">
        연결이 끊겼습니다.{" "}
        <button type="button" onClick={onReconnect}>
          재연결
        </button>
      </p>
    );
  }
  if (connectionState === "connecting") return <p>연결 중…</p>;
  return null;
}
