import { aliasOf } from "./agent-alias";
import type { AgentListItem, Conversation, OpenRoom, RoomListItem, Selection } from "./types";

export interface SidebarProps {
  selection: Selection;
  rooms: RoomListItem[];
  openRooms: Map<string, OpenRoom>;
  conversations: Map<string, Conversation>;
  agents: AgentListItem[];
  onSelectAgents(): void;
  onSelectRooms(): void;
  onSelectSettings(): void;
  onSelectRoom(id: string): void;
  onSelectDm(uuid: string): void;
  userEmail: string;
  onLogout(): void;
}

function isSelected(selection: Selection, key: "agents" | "rooms" | "settings"): boolean {
  return selection === key;
}

function selectedRoomId(selection: Selection): string | null {
  return typeof selection === "object" && "room" in selection ? selection.room : null;
}

function selectedDmUuid(selection: Selection): string | null {
  return typeof selection === "object" && "dm" in selection ? selection.dm : null;
}

export function Sidebar({
  selection,
  rooms,
  openRooms,
  conversations,
  agents,
  onSelectAgents,
  onSelectRooms,
  onSelectSettings,
  onSelectRoom,
  onSelectDm,
  userEmail,
  onLogout,
}: SidebarProps) {
  const ongoingRooms = rooms.filter((r) => r.status !== "ended");
  const activeRoomId = selectedRoomId(selection);
  const activeDmUuid = selectedDmUuid(selection);

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        <button
          type="button"
          className="sidebar-item"
          aria-current={isSelected(selection, "agents")}
          onClick={onSelectAgents}
        >
          <span className="label">에이전트</span>
        </button>
        <button
          type="button"
          className="sidebar-item"
          aria-current={isSelected(selection, "rooms")}
          onClick={onSelectRooms}
        >
          <span className="label">room</span>
        </button>
      </nav>

      <section className="sidebar-section">
        <h2>room — 진행 중</h2>
        {ongoingRooms.map((r) => (
          <button
            key={r.id}
            type="button"
            className="sidebar-item"
            aria-current={activeRoomId === r.id}
            onClick={() => onSelectRoom(r.id)}
          >
            <span className="label">{r.name}</span>
            {openRooms.get(r.id)?.unread === true && <span className="dot" role="status" aria-label="읽지 않음" />}
            <span className="badge">{r.status === "active" ? "진행 중" : "준비 중"}</span>
          </button>
        ))}
      </section>

      <section className="sidebar-section">
        <h2>1:1 — 이번 접속</h2>
        {[...conversations.entries()].map(([uuid, conv]) => (
          <button
            key={uuid}
            type="button"
            className="sidebar-item"
            aria-current={activeDmUuid === uuid}
            onClick={() => onSelectDm(uuid)}
          >
            <span className="label">{aliasOf(agents, uuid)}</span>
            {conv.unread && <span className="dot" role="status" aria-label="읽지 않음" />}
          </button>
        ))}
      </section>

      <div className="sidebar-footer">
        <span className="email">{userEmail}</span>
        <button
          type="button"
          className="secondary"
          aria-current={isSelected(selection, "settings")}
          onClick={onSelectSettings}
        >
          설정
        </button>
        <button type="button" className="outline secondary" onClick={onLogout}>
          로그아웃
        </button>
      </div>
    </aside>
  );
}
