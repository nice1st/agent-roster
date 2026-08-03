import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";
import { AgentsView } from "./agents-view";
import { useBrokerStream } from "./broker-stream";
import { DmView } from "./dm-view";
import type { InfoPanelTarget } from "./info-panel";
import { InfoPanel } from "./info-panel";
import { RoomSetup } from "./room-setup";
import { RoomView } from "./room-view";
import type { CreateRoomPayload } from "./rooms-view";
import { RoomsView } from "./rooms-view";
import { SettingsView } from "./settings-view";
import { Sidebar } from "./sidebar";
import type {
  AgentListItem,
  Conversation,
  OpenRoom,
  RoomChatMessage,
  RoomListItem,
  RoomParticipantItem,
  Selection,
} from "./types";
import { getJson, postJson } from "./types";

const authClient = createAuthClient();

async function fetchRoomBackfill(
  roomId: string,
): Promise<{ messages: RoomChatMessage[]; participants: RoomParticipantItem[] }> {
  const res = await fetch(`/api/rooms/${roomId}/messages`);
  if (!res.ok) throw new Error(`기록 조회 실패 (${res.status})`);
  const body = (await res.json()) as {
    messages: { id: number; from: string; from_label?: string; content: string; sent_at: string }[];
    participants: RoomParticipantItem[];
  };
  return {
    messages: body.messages.map((m) => ({
      id: m.id,
      from: m.from,
      fromLabel: m.from_label,
      message: m.content,
      sentAt: m.sent_at,
    })),
    participants: body.participants,
  };
}

export function App() {
  const { data: session, isPending } = authClient.useSession();

  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

  const [conversations, setConversations] = useState<Map<string, Conversation>>(new Map());
  const [openRooms, setOpenRooms] = useState<Map<string, OpenRoom>>(new Map());
  const [selection, setSelection] = useState<Selection>("agents");
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  function aliasOf(uuid: string): string {
    return agents.find((a) => a.uuid === uuid)?.meta.alias ?? uuid;
  }

  function isDmSelected(uuid: string): boolean {
    return typeof selection === "object" && "dm" in selection && selection.dm === uuid;
  }

  function isRoomSelected(id: string): boolean {
    return typeof selection === "object" && "room" in selection && selection.room === id;
  }

  function handleIncomingMessage(from: string, message: string, sentAt: string) {
    setConversations((prev) => {
      const next = new Map(prev);
      const existing = next.get(from);
      const unread = !isDmSelected(from);
      if (existing !== undefined) {
        next.set(from, { ...existing, messages: [...existing.messages, { from, message, sentAt }], unread });
      } else {
        next.set(from, { label: aliasOf(from), messages: [{ from, message, sentAt }], unread });
      }
      return next;
    });
  }

  function handleRoomMessage(
    room: string,
    from: string,
    fromLabel: string | undefined,
    message: string,
    sentAt: string,
  ) {
    setOpenRooms((prev) => {
      if (!prev.has(room)) return prev;
      const next = new Map(prev);
      const existing = next.get(room) as OpenRoom;
      next.set(room, {
        ...existing,
        messages: [...existing.messages, { from, fromLabel, message, sentAt }],
        unread: !isRoomSelected(room),
      });
      return next;
    });
  }

  function handleRoomEnd(room: string) {
    setOpenRooms((prev) => {
      if (!prev.has(room)) return prev;
      const next = new Map(prev);
      next.set(room, { ...(next.get(room) as OpenRoom), status: "ended" });
      return next;
    });
    reloadRooms();
  }

  function getOpenRoomIds(): string[] {
    return [...openRooms.entries()].filter(([, r]) => r.status === "active").map(([id]) => id);
  }

  const stream = useBrokerStream({
    onMessage: handleIncomingMessage,
    onRoomMessage: handleRoomMessage,
    onRoomEnd: handleRoomEnd,
    onError: (e) => setStreamError(e),
    getOpenRoomIds,
  });

  async function reloadAgents() {
    setAgentsLoading(true);
    try {
      const res = await getJson<{ agents: AgentListItem[] }>("/api/agents");
      setAgents(res.agents);
      setAgentsError(null);
    } catch (e) {
      setAgentsError(e instanceof Error ? e.message : String(e));
    } finally {
      setAgentsLoading(false);
    }
  }

  async function reloadRooms() {
    setRoomsLoading(true);
    try {
      const res = await getJson<{ rooms: RoomListItem[] }>("/api/rooms");
      setRooms(res.rooms);
    } finally {
      setRoomsLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: 마운트 시 1회만 초기 로드한다.
  useEffect(() => {
    reloadAgents();
    reloadRooms();
  }, []);

  async function loadRoom(id: string, name: string, status: "active" | "ended") {
    setOpenRooms((prev) => {
      const next = new Map(prev);
      next.set(id, { name, status, messages: [], participants: [], unread: false });
      return next;
    });
    try {
      const backfill = await fetchRoomBackfill(id);
      setOpenRooms((prev) => {
        const next = new Map(prev);
        next.set(id, {
          name,
          status,
          messages: backfill.messages,
          participants: backfill.participants,
          unread: false,
        });
        return next;
      });
      if (status === "active") await stream.watchRoom(id);
    } catch (e) {
      setStreamError(e instanceof Error ? e.message : String(e));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: room 선택이 바뀔 때만 backfill·watch를 건다 — openRooms를 deps에 넣으면 메시지가 올 때마다 재실행된다.
  useEffect(() => {
    if (typeof selection !== "object" || !("room" in selection)) return;
    const id = selection.room;
    const meta = rooms.find((r) => r.id === id);
    if (meta === undefined || meta.status === "draft") return;
    if (openRooms.has(id)) return;
    loadRoom(id, meta.name, meta.status);
  }, [selection, rooms]);

  function selectDm(uuid: string) {
    setConversations((prev) => {
      const existing = prev.get(uuid);
      if (existing === undefined || !existing.unread) return prev;
      const next = new Map(prev);
      next.set(uuid, { ...existing, unread: false });
      return next;
    });
    setSelection({ dm: uuid });
  }

  function openDm(uuid: string, label: string) {
    setConversations((prev) => {
      const next = new Map(prev);
      const existing = next.get(uuid);
      next.set(uuid, existing === undefined ? { label, messages: [], unread: false } : { ...existing, unread: false });
      return next;
    });
    setSelection({ dm: uuid });
  }

  function selectRoom(id: string) {
    setOpenRooms((prev) => {
      const existing = prev.get(id);
      if (existing === undefined || !existing.unread) return prev;
      const next = new Map(prev);
      next.set(id, { ...existing, unread: false });
      return next;
    });
    setSelection({ room: id });
  }

  async function sendDm(peerUuid: string, message: string) {
    const result = await stream.sendDirect(peerUuid, message);
    if (!result.ok) {
      setStreamError(result.error ?? "전송 실패");
      return;
    }
    const from = stream.myUuid ?? "";
    setConversations((prev) => {
      const next = new Map(prev);
      const existing = next.get(peerUuid);
      const appended = { from, message, sentAt: new Date().toISOString() };
      next.set(
        peerUuid,
        existing === undefined
          ? { label: aliasOf(peerUuid), messages: [appended], unread: false }
          : { ...existing, messages: [...existing.messages, appended] },
      );
      return next;
    });
  }

  async function sendRoomMessage(roomId: string, message: string) {
    const result = await stream.sendRoom(roomId, message);
    if (!result.ok) {
      setStreamError(result.error ?? "전송 실패");
      return;
    }
    // 브로커 팬아웃이 발신자를 제외하므로 자기 발언은 스트림으로 돌아오지 않는다 — 여기서 직접 붙인다.
    const from = stream.myUuid ?? "";
    setOpenRooms((prev) => {
      if (!prev.has(roomId)) return prev;
      const next = new Map(prev);
      const existing = next.get(roomId) as OpenRoom;
      next.set(roomId, {
        ...existing,
        messages: [...existing.messages, { from, message, sentAt: new Date().toISOString() }],
      });
      return next;
    });
  }

  async function createRoom(payload: CreateRoomPayload): Promise<{ ok: boolean; error?: string }> {
    const res = await postJson("/api/rooms", payload);
    if (res.ok) {
      await reloadRooms();
      return { ok: true };
    }
    const body = (await res.json()) as { error?: string };
    return { ok: false, error: body.error };
  }

  async function endRoomAction(id: string) {
    const res = await postJson(`/api/rooms/${id}/end`, {});
    if (res.ok) {
      await reloadRooms();
      setOpenRooms((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.set(id, { ...(next.get(id) as OpenRoom), status: "ended" });
        return next;
      });
    } else {
      const body = (await res.json()) as { error?: string };
      setStreamError(body.error ?? "종료 실패");
    }
  }

  function computeInfoPanelTarget(): InfoPanelTarget | null {
    if (!infoPanelOpen) return null;
    if (typeof selection === "object" && "room" in selection) {
      const room = openRooms.get(selection.room);
      if (room === undefined) return null;
      return {
        kind: "room",
        roomId: selection.room,
        name: room.name,
        status: room.status,
        participants: room.participants,
      };
    }
    if (typeof selection === "object" && "dm" in selection) {
      const conv = conversations.get(selection.dm);
      if (conv === undefined) return null;
      const agent = agents.find((a) => a.uuid === selection.dm);
      return { kind: "dm", peerUuid: selection.dm, label: conv.label, meta: agent?.meta ?? null };
    }
    return null;
  }

  function renderBody() {
    if (selection === "agents") {
      return (
        <AgentsView
          agents={agents}
          loading={agentsLoading}
          error={agentsError}
          onReload={reloadAgents}
          onChat={openDm}
        />
      );
    }
    if (selection === "rooms") {
      return (
        <RoomsView
          rooms={rooms}
          loading={roomsLoading}
          onReload={reloadRooms}
          onCreateRoom={createRoom}
          onOpenRoom={selectRoom}
          onEndRoom={endRoomAction}
        />
      );
    }
    if (selection === "settings") {
      return <SettingsView isAdmin={(session?.user as { role?: string } | undefined)?.role === "admin"} />;
    }
    if (typeof selection === "object" && "dm" in selection) {
      const conv = conversations.get(selection.dm);
      if (conv === undefined) return null;
      return (
        <DmView
          key={selection.dm}
          peerUuid={selection.dm}
          conversation={conv}
          myUuid={stream.myUuid}
          connectionState={stream.state}
          onReconnect={stream.reconnect}
          onSend={sendDm}
          infoOpen={infoPanelOpen}
          onToggleInfo={() => setInfoPanelOpen((v) => !v)}
        />
      );
    }
    if (typeof selection === "object" && "room" in selection) {
      const meta = rooms.find((r) => r.id === selection.room);
      if (meta !== undefined && meta.status === "draft") {
        return (
          <RoomSetup
            key={selection.room}
            room={meta}
            agents={agents}
            onReloadAgents={reloadAgents}
            onStarted={() => {
              reloadRooms();
              setSelection("rooms");
            }}
            onBack={() => setSelection("rooms")}
          />
        );
      }
      const room = openRooms.get(selection.room);
      if (room === undefined) return <p>불러오는 중…</p>;
      return (
        <RoomView
          key={selection.room}
          roomId={selection.room}
          room={room}
          myUuid={stream.myUuid}
          connectionState={stream.state}
          onReconnect={stream.reconnect}
          onSend={sendRoomMessage}
          infoOpen={infoPanelOpen}
          onToggleInfo={() => setInfoPanelOpen((v) => !v)}
        />
      );
    }
    return null;
  }

  if (isPending) {
    return <p>세션 확인 중…</p>;
  }

  if (session === null) {
    return (
      <main className="container">
        <h1>agent-roster</h1>
        <p>초대된 계정만 로그인할 수 있다.</p>
        <button type="button" onClick={() => authClient.signIn.social({ provider: "google" })}>
          Google로 로그인
        </button>
      </main>
    );
  }

  const infoPanelTarget = computeInfoPanelTarget();
  const isChatSelection = typeof selection === "object";

  return (
    <div className="app-shell" data-info={infoPanelTarget !== null ? "true" : undefined}>
      <Sidebar
        selection={selection}
        rooms={rooms}
        openRooms={openRooms}
        conversations={conversations}
        onSelectAgents={() => setSelection("agents")}
        onSelectRooms={() => setSelection("rooms")}
        onSelectSettings={() => setSelection("settings")}
        onSelectRoom={selectRoom}
        onSelectDm={selectDm}
        userEmail={session.user.email}
        onLogout={() => authClient.signOut()}
      />
      <main className={isChatSelection ? "app-main app-main--chat" : "app-main"}>
        {streamError !== null && <p role="alert">{streamError}</p>}
        {renderBody()}
      </main>
      {infoPanelTarget !== null && <InfoPanel target={infoPanelTarget} onEndRoom={endRoomAction} />}
    </div>
  );
}
