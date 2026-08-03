import { useRef, useState } from "react";
import type { ConnectionState } from "./broker-stream";
import { senderColor } from "./sender-color";
import type { OpenRoom } from "./types";
import { useStickToBottom } from "./use-stick-to-bottom";

export interface RoomViewProps {
  roomId: string;
  room: OpenRoom;
  myUuid: string | null;
  connectionState: ConnectionState;
  onReconnect(): void;
  onSend(roomId: string, message: string): void;
  infoOpen: boolean;
  onToggleInfo(): void;
}

export function RoomView({
  roomId,
  room,
  myUuid,
  connectionState,
  onReconnect,
  onSend,
  infoOpen,
  onToggleInfo,
}: RoomViewProps) {
  const [draft, setDraft] = useState("");
  const { logRef, onScroll } = useStickToBottom(room.messages);
  const wasActiveOnOpenRef = useRef(room.status === "active");
  const justEnded = wasActiveOnOpenRef.current && room.status === "ended";

  function send() {
    if (draft.trim() === "" || room.status === "ended") return;
    onSend(roomId, draft);
    setDraft("");
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <div>
          <h1>room: {room.name}</h1>
          <p role="note" className="meta">
            {room.status === "ended" ? "이 room은 종료됐습니다. 기록만 조회할 수 있습니다." : "room 대화는 기록됩니다."}
          </p>
        </div>
        <button type="button" className="outline secondary" onClick={onToggleInfo}>
          {infoOpen ? "정보 닫기" : "정보"}
        </button>
      </div>

      {justEnded && <p role="alert">이 room이 방금 종료됐습니다. 더 이상 발언할 수 없습니다.</p>}
      {room.status === "active" && connectionState === "disconnected" && (
        <p role="alert">
          연결이 끊겼습니다.{" "}
          <button type="button" onClick={onReconnect}>
            재연결
          </button>
        </p>
      )}
      {room.status === "active" && connectionState === "connecting" && <p>연결 중…</p>}

      <ul role="log" ref={logRef} onScroll={onScroll} className="chat-log">
        {room.messages.map((m, i) => {
          const grouped = i > 0 && room.messages[i - 1]?.from === m.from;
          return (
            <li key={m.id ?? `stream-${i}`} style={{ marginTop: grouped ? "0.125rem" : "0.75rem" }}>
              {!grouped && (
                <strong style={{ color: senderColor(m.from) }}>
                  {m.from === myUuid ? "me" : (m.fromLabel ?? m.from)}
                </strong>
              )}
              <span style={{ whiteSpace: "pre-wrap", display: "block" }}>{m.message}</span>
            </li>
          );
        })}
      </ul>

      {room.status === "active" && (
        <div className="chat-input-bar">
          <input
            id="room-view-draft"
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
      )}
    </div>
  );
}
