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
  moderator_required: boolean;
  moderator_instruction: string | null;
}

const DEFAULT_MODERATOR_TEXT = `'사회자' 역할: 주제와 발언 순서를 통제한다.
- 진행 규칙과 컨텍스트를 먼저 정리하고 첫 주제를 연다.
- 발언 정리는 재진술하지 말고 한 줄 압축 + 핵심 질문으로.
- 수용만 하지 마라 — 빈틈은 직접 반박하고, 이견이 보이면 두 참가자를 교차 지정해 맞붙여라.
- 다음 발언자는 순번이 아니라 "이 지점을 반박할 여지가 큰 사람"으로 지정하라.
- 네 턴 끝에는 반드시 다음 발언자 지정이 있어야 한다.`;

const DEFAULT_MODERATOR_NOTICE = `진행 안내: 이 room은 사회자가 진행한다.
주제 제시와 다음 발언자 지정은 사회자가 하며, 사회자의 지정을 받았을 때 발언하라.`;

export interface RoomsPageProps {
  onBack: () => void;
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
  const [newModeratorRequired, setNewModeratorRequired] = useState(false);
  const [newModeratorNotice, setNewModeratorNotice] = useState(DEFAULT_MODERATOR_NOTICE);
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
    // 사회자 안내문은 별도 필드가 아니라 context에 합쳐 저장한다 — 참여자는 room-start의 context로 받는다.
    const notice = newModeratorRequired ? newModeratorNotice.trim() : "";
    const context = [newContext.trim(), notice].filter((s) => s !== "").join("\n\n");
    const res = await postJson("/api/rooms", {
      name: newName.trim(),
      context: context === "" ? undefined : context,
      duration_minutes: durationMinutes,
      moderator_required: newModeratorRequired ? true : undefined,
    });
    if (res.ok) {
      setNewName("");
      setNewContext("");
      setNewDuration("");
      setNewModeratorRequired(false);
      setNewModeratorNotice(DEFAULT_MODERATOR_NOTICE);
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
        <textarea
          style={{ width: "100%", maxWidth: "48rem" }}
          value={newContext}
          onChange={(e) => setNewContext(e.target.value)}
          rows={4}
          placeholder={
            "컨텍스트(선택) — 주제와 발언 규칙을 함께 쓰면 좋다. 예:\n" +
            "주제: ...\n" +
            "발언 규칙: 첫 발언은 ○○부터, 첫 바퀴는 자기소개. 발언 끝에 다음 발언자를 호명하고, 호명되기 전에는 발언하지 않는다."
          }
        />
        <input
          value={newDuration}
          onChange={(e) => setNewDuration(e.target.value)}
          placeholder="지속 시간(분, 비우면 무제한)"
          type="number"
        />
        <p>
          <label>
            <input
              type="checkbox"
              checked={newModeratorRequired}
              onChange={(e) => setNewModeratorRequired(e.target.checked)}
            />
            사회자 필수
          </label>
        </p>
        {newModeratorRequired && (
          <textarea
            style={{ width: "100%", maxWidth: "48rem" }}
            value={newModeratorNotice}
            onChange={(e) => setNewModeratorNotice(e.target.value)}
            rows={3}
          />
        )}
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
  const [moderatorUuid, setModeratorUuid] = useState("");
  const [moderatorText, setModeratorText] = useState(DEFAULT_MODERATOR_TEXT);

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
      if (moderatorUuid === uuid) setModeratorUuid("");
    } else {
      setError((await res.json()).error ?? "참여자 제거 실패");
    }
  }

  async function applyModeratorPersona(): Promise<boolean> {
    const target = participants.find((p) => p.agent_uuid === moderatorUuid);
    if (target === undefined || moderatorText.trim() === "") return true;
    const merged = target.persona === null ? moderatorText : `${target.persona}\n\n${moderatorText}`;
    const res = await fetch(`/api/rooms/${room.id}/participants/${target.agent_uuid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona: merged }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "사회자 지정 실패");
      return false;
    }
    setParticipants((prev) => prev.map((p) => (p.agent_uuid === target.agent_uuid ? { ...p, persona: merged } : p)));
    return true;
  }

  async function startRoom() {
    if (room.moderator_required && moderatorUuid === "") {
      setError("이 room은 사회자 필수입니다 — 사회자를 지정한 뒤 시작하세요");
      return;
    }
    if (moderatorUuid !== "" && !(await applyModeratorPersona())) return;
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
      <textarea
        style={{ width: "100%", maxWidth: "48rem" }}
        value={persona}
        onChange={(e) => setPersona(e.target.value)}
        rows={3}
        placeholder="페르소나(선택) — 이 에이전트가 room에서 맡을 역할·관점"
      />
      <input
        value={outputInstruction}
        onChange={(e) => setOutputInstruction(e.target.value)}
        placeholder="산출물 지시(선택)"
      />
      <button type="button" onClick={addParticipant}>
        추가
      </button>

      <p>
        <label>
          사회자 지정(선택){" "}
          <select value={moderatorUuid} onChange={(e) => setModeratorUuid(e.target.value)}>
            <option value="">없음</option>
            {participants.map((p) => (
              <option key={p.agent_uuid} value={p.agent_uuid}>
                {p.alias_snapshot ?? p.agent_uuid}
              </option>
            ))}
          </select>
        </label>
      </p>
      {moderatorUuid !== "" && (
        <textarea
          style={{ width: "100%", maxWidth: "48rem" }}
          value={moderatorText}
          onChange={(e) => setModeratorText(e.target.value)}
          rows={6}
        />
      )}

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
