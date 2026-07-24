// room 화면(03 §2 "room", 05 §2 #12·#13) — 목록·생성, draft 상태의 참여자 배치·시작, active 상태로 진입 시
// RoomPanel(room-panel.tsx)로 넘긴다. 여기서는 draft 관리 화면까지만 다룬다.
import { useEffect, useState } from "react";

interface AgentMeta {
  machine?: string;
  cwd?: string;
  alias?: string;
  status?: string;
}

interface AgentListItem {
  uuid: string;
  meta: AgentMeta;
  owner: { email: string };
}

interface RoomListItem {
  id: string;
  name: string;
  context: string | null;
  status: "draft" | "active" | "ended";
  duration_minutes: number;
  ends_at: string | null;
  created_at: string;
}

export interface RoomsPageProps {
  onBack: () => void;
  /** active room은 대화 화면(#13), ended room은 기록 조회 화면(#15)으로 넘긴다 — RoomPanel이 status로 분기한다. */
  onOpenRoom: (roomId: string, roomName: string, status: "active" | "ended") => void;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`요청 실패: ${url} (${res.status})`);
  return (await res.json()) as T;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export function RoomsPage({ onBack, onOpenRoom }: RoomsPageProps) {
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newContext, setNewContext] = useState("");
  const [newDuration, setNewDuration] = useState("");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  async function reload() {
    try {
      const res = await getJson<{ rooms: RoomListItem[] }>("/api/rooms");
      setRooms(res.rooms);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: 마운트 시 1회만 초기 로드한다.
  useEffect(() => {
    reload();
  }, []);

  async function createRoom() {
    if (newName.trim() === "") return;
    const durationMinutes = newDuration.trim() === "" ? undefined : Number(newDuration);
    const res = await postJson("/api/rooms", {
      name: newName.trim(),
      context: newContext.trim() === "" ? undefined : newContext.trim(),
      duration_minutes: durationMinutes,
    });
    if (res.ok) {
      setNewName("");
      setNewContext("");
      setNewDuration("");
      await reload();
    } else {
      setError((await res.json()).error ?? "room 생성 실패");
    }
  }

  async function endRoom(roomId: string) {
    const res = await postJson(`/api/rooms/${roomId}/end`, {});
    if (res.ok) {
      await reload();
    } else {
      setError((await res.json()).error ?? "종료 실패");
    }
  }

  const selected = rooms.find((r) => r.id === selectedRoomId) ?? null;

  return (
    <main>
      <h1>room</h1>
      {error !== null && <p role="alert">{error}</p>}

      <section>
        <h2>새 room 만들기</h2>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="이름" />
        <input value={newContext} onChange={(e) => setNewContext(e.target.value)} placeholder="컨텍스트(선택)" />
        <input
          value={newDuration}
          onChange={(e) => setNewDuration(e.target.value)}
          placeholder="지속 시간(분, 비우면 무제한)"
          type="number"
        />
        <button type="button" onClick={createRoom}>
          생성
        </button>
      </section>

      <section>
        <h2>내 room 목록</h2>
        <button type="button" onClick={reload}>
          새로고침
        </button>
        <table>
          <thead>
            <tr>
              <th>이름</th>
              <th>상태</th>
              <th>종료 시각</th>
              <th> </th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.status}</td>
                <td>{r.ends_at ?? "무제한"}</td>
                <td>
                  {r.status === "draft" && (
                    <button type="button" onClick={() => setSelectedRoomId(r.id)}>
                      참여자 배치
                    </button>
                  )}
                  {r.status === "active" && (
                    <>
                      <button type="button" onClick={() => onOpenRoom(r.id, r.name, "active")}>
                        열기
                      </button>
                      <button type="button" onClick={() => endRoom(r.id)}>
                        종료
                      </button>
                    </>
                  )}
                  {r.status === "ended" && (
                    <button type="button" onClick={() => onOpenRoom(r.id, r.name, "ended")}>
                      기록 보기
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {selected !== null && (
        <RoomSetupPanel
          room={selected}
          onStarted={() => {
            setSelectedRoomId(null);
            reload();
          }}
          onClose={() => setSelectedRoomId(null)}
        />
      )}

      <p>
        <button type="button" onClick={onBack}>
          뒤로
        </button>
      </p>
    </main>
  );
}

interface RoomParticipantItem {
  agent_uuid: string;
  alias_snapshot: string | null;
  persona: string | null;
  output_instruction: string | null;
}

function RoomSetupPanel({
  room,
  onStarted,
  onClose,
}: {
  room: RoomListItem;
  onStarted: () => void;
  onClose: () => void;
}) {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [selectedUuid, setSelectedUuid] = useState("");
  const [persona, setPersona] = useState("");
  const [outputInstruction, setOutputInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RoomParticipantItem[]>([]);

  async function loadAgents() {
    const res = await getJson<{ agents: AgentListItem[] }>("/api/agents");
    setAgents(res.agents);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: room이 바뀌면 새 화면이므로 재로드한다.
  useEffect(() => {
    loadAgents();
    setParticipants([]);
  }, [room.id]);

  async function addParticipant() {
    if (selectedUuid === "") return;
    const res = await postJson(`/api/rooms/${room.id}/participants`, {
      agent_uuid: selectedUuid,
      persona: persona.trim() === "" ? undefined : persona.trim(),
      output_instruction: outputInstruction.trim() === "" ? undefined : outputInstruction.trim(),
    });
    if (res.ok) {
      const agent = agents.find((a) => a.uuid === selectedUuid);
      setParticipants((prev) => [
        ...prev,
        {
          agent_uuid: selectedUuid,
          alias_snapshot: agent?.meta.alias ?? null,
          persona: persona.trim() === "" ? null : persona.trim(),
          output_instruction: outputInstruction.trim() === "" ? null : outputInstruction.trim(),
        },
      ]);
      setSelectedUuid("");
      setPersona("");
      setOutputInstruction("");
      setError(null);
    } else {
      setError((await res.json()).error ?? "참여자 배치 실패");
    }
  }

  async function removeParticipant(uuid: string) {
    const res = await fetch(`/api/rooms/${room.id}/participants/${uuid}`, { method: "DELETE" });
    if (res.ok) {
      setParticipants((prev) => prev.filter((p) => p.agent_uuid !== uuid));
    } else {
      setError((await res.json()).error ?? "참여자 제거 실패");
    }
  }

  async function startRoom() {
    const res = await postJson(`/api/rooms/${room.id}/start`, {});
    if (res.ok) {
      onStarted();
    } else {
      setError((await res.json()).error ?? "시작 실패");
    }
  }

  return (
    <section>
      <h2>{room.name} — 참여자 배치</h2>
      {error !== null && <p role="alert">{error}</p>}

      <ul>
        {participants.map((p) => (
          <li key={p.agent_uuid}>
            {p.alias_snapshot ?? p.agent_uuid} {p.persona !== null && `(${p.persona})`}{" "}
            <button type="button" onClick={() => removeParticipant(p.agent_uuid)}>
              제거
            </button>
          </li>
        ))}
      </ul>

      <select value={selectedUuid} onChange={(e) => setSelectedUuid(e.target.value)}>
        <option value="">에이전트 선택</option>
        {agents.map((a) => (
          <option key={a.uuid} value={a.uuid}>
            {a.meta.alias ?? a.owner.email} ({a.uuid})
          </option>
        ))}
      </select>
      <input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="페르소나(선택)" />
      <input
        value={outputInstruction}
        onChange={(e) => setOutputInstruction(e.target.value)}
        placeholder="산출물 지시(선택)"
      />
      <button type="button" onClick={addParticipant}>
        추가
      </button>

      <p>
        <button type="button" onClick={startRoom}>
          시작
        </button>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </p>
    </section>
  );
}
