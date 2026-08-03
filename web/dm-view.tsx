import { aliasOf } from "./agent-alias";
import type { ConnectionState } from "./broker-stream";
import { ChatComposer } from "./chat-composer";
import { ChatLog, ConnectionBanner } from "./chat-log";
import type { AgentListItem, Conversation } from "./types";

export interface DmViewProps {
  peerUuid: string;
  conversation: Conversation;
  agents: AgentListItem[];
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
  agents,
  myUuid,
  connectionState,
  onReconnect,
  onSend,
  infoOpen,
  onToggleInfo,
}: DmViewProps) {
  const label = aliasOf(agents, peerUuid);

  return (
    <div className="chat-view">
      <div className="chat-header">
        <div>
          <h1>{label}</h1>
          <p role="note" className="meta">
            1:1 대화는 기록되지 않습니다 — 새로고침하면 사라집니다.
          </p>
        </div>
        <button type="button" className="outline secondary" onClick={onToggleInfo}>
          {infoOpen ? "정보 닫기" : "정보"}
        </button>
      </div>

      <ConnectionBanner connectionState={connectionState} onReconnect={onReconnect} />

      <ChatLog messages={conversation.messages} myUuid={myUuid} labelOf={() => label} />

      {conversation.error !== null && <p role="alert">{conversation.error}</p>}

      <ChatComposer inputId="chat-draft" disabled={myUuid === null} onSend={(message) => onSend(peerUuid, message)} />
    </div>
  );
}
