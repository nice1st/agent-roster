import { useRef } from "react";
import type { ConnectionState } from "./broker-stream";
import { ChatComposer } from "./chat-composer";
import { ChatLog, ConnectionBanner } from "./chat-log";
import type { OpenRoom } from "./types";

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
  const wasActiveOnOpenRef = useRef(room.status === "active");
  const justEnded = wasActiveOnOpenRef.current && room.status === "ended";

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
      {room.status === "active" && <ConnectionBanner connectionState={connectionState} onReconnect={onReconnect} />}

      <ChatLog messages={room.messages} myUuid={myUuid} labelOf={(m) => m.fromLabel ?? m.from} />

      {room.error !== null && <p role="alert">{room.error}</p>}

      {room.status === "active" && (
        <ChatComposer
          inputId="room-view-draft"
          disabled={myUuid === null}
          onSend={(message) => onSend(roomId, message)}
        />
      )}
    </div>
  );
}
