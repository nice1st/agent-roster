import type { AgentMeta, RoomParticipantItem } from "./types";

export type InfoPanelTarget =
  | { kind: "room"; roomId: string; name: string; status: "active" | "ended"; participants: RoomParticipantItem[] }
  | { kind: "dm"; peerUuid: string; label: string; meta: AgentMeta | null };

export interface InfoPanelProps {
  target: InfoPanelTarget;
  onEndRoom(roomId: string): void;
}

export function InfoPanel({ target, onEndRoom }: InfoPanelProps) {
  if (target.kind === "dm") {
    return (
      <aside className="info-panel">
        <h2>{target.label}</h2>
        <p role="note">1:1 대화는 기록되지 않습니다.</p>
        {target.meta === null ? (
          <p>추가 정보 없음</p>
        ) : (
          <dl>
            <dt>machine</dt>
            <dd>{target.meta.machine ?? ""}</dd>
            <dt>cwd</dt>
            <dd>{target.meta.cwd ?? ""}</dd>
            <dt>status</dt>
            <dd>{target.meta.status ?? ""}</dd>
          </dl>
        )}
      </aside>
    );
  }

  return (
    <aside className="info-panel">
      <h2>{target.name}</h2>
      <p>상태: {target.status === "active" ? "진행 중" : "종료됨"}</p>
      <h3>참여자</h3>
      <ul>
        {target.participants.map((p) => (
          <li key={p.agent_uuid}>
            {p.alias_snapshot ?? p.agent_uuid} {p.persona !== null && `(${p.persona})`}
          </li>
        ))}
      </ul>
      {target.status === "active" && (
        <button type="button" className="outline contrast" onClick={() => onEndRoom(target.roomId)}>
          종료
        </button>
      )}
    </aside>
  );
}
