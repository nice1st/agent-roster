import { useState } from "react";
import type { ConnectionState } from "./broker-stream";
import { senderColor } from "./sender-color";
import type { Conversation } from "./types";
import { useStickToBottom } from "./use-stick-to-bottom";

export interface DmViewProps {
  peerUuid: string;
  conversation: Conversation;
  myUuid: string | null;
  connectionState: ConnectionState;
  onReconnect(): void;
  onSend(peerUuid: string, message: string): void;
  infoOpen: boolean;
  onToggleInfo(): void;
}

export function DmView({
  peerUuid,
  conversation,
  myUuid,
  connectionState,
  onReconnect,
  onSend,
  infoOpen,
  onToggleInfo,
}: DmViewProps) {
  const [draft, setDraft] = useState("");
  const { logRef, onScroll } = useStickToBottom(conversation.messages);

  function send() {
    if (draft.trim() === "") return;
    onSend(peerUuid, draft);
    setDraft("");
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <div>
          <h1>{conversation.label}</h1>
          <p role="note" className="meta">
            1:1 대화는 기록되지 않습니다 — 새로고침하면 사라집니다.
          </p>
        </div>
        <button type="button" className="outline secondary" onClick={onToggleInfo}>
          {infoOpen ? "정보 닫기" : "정보"}
        </button>
      </div>

      {connectionState === "disconnected" && (
        <p role="alert">
          연결이 끊겼습니다.{" "}
          <button type="button" onClick={onReconnect}>
            재연결
          </button>
        </p>
      )}
      {connectionState === "connecting" && <p>연결 중…</p>}

      <ul role="log" ref={logRef} onScroll={onScroll} className="chat-log">
        {conversation.messages.map((m, i) => {
          const grouped = i > 0 && conversation.messages[i - 1]?.from === m.from;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: 기록되지 않는 화면용 로그라 인덱스로 충분하다.
            <li key={i} style={{ marginTop: grouped ? "0.125rem" : "0.75rem" }}>
              {!grouped && (
                <strong style={{ color: senderColor(m.from) }}>{m.from === myUuid ? "me" : conversation.label}</strong>
              )}
              <span style={{ whiteSpace: "pre-wrap", display: "block" }}>{m.message}</span>
            </li>
          );
        })}
      </ul>

      <div className="chat-input-bar">
        <input
          id="chat-draft"
          aria-label="메시지 입력"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 한글 IME 조합 중 Enter는 keydown이 두 번 발화한다 — 조합 확정분은 무시해야 중복 발신이 없다.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
          disabled={myUuid === null}
          placeholder="메시지 입력"
        />
        <button type="button" onClick={send} disabled={myUuid === null}>
          전송
        </button>
      </div>
    </div>
  );
}
