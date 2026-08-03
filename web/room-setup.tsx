import { useEffect, useState } from "react";
import type { AgentListItem, RoomListItem, RoomParticipantItem } from "./types";
import { postJson } from "./types";

const DEFAULT_MODERATOR_TEXT = `'사회자' 역할: 주제와 발언 순서를 통제한다.
- 진행 규칙과 컨텍스트를 먼저 정리하고 첫 주제를 연다.
- 발언 정리는 재진술하지 말고 한 줄 압축 + 핵심 질문으로.
- 수용만 하지 마라 — 빈틈은 직접 반박하고, 이견이 보이면 두 참가자를 교차 지정해 맞붙여라.
- 다음 발언자는 순번이 아니라 "이 지점을 반박할 여지가 큰 사람"으로 지정하라.
- 네 턴 끝에는 반드시 다음 발언자 지정이 있어야 한다.`;

export interface RoomSetupProps {
  room: RoomListItem;
  agents: AgentListItem[];
  onReloadAgents(): void;
  onStarted(): void;
  onBack(): void;
}

export function RoomSetup({ room, agents, onReloadAgents, onStarted, onBack }: RoomSetupProps) {
  const [selectedUuid, setSelectedUuid] = useState("");
  const [persona, setPersona] = useState("");
  const [outputInstruction, setOutputInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RoomParticipantItem[]>([]);
  const [moderatorUuid, setModeratorUuid] = useState("");
  const [moderatorText, setModeratorText] = useState(DEFAULT_MODERATOR_TEXT);

  // biome-ignore lint/correctness/useExhaustiveDependencies: room이 바뀌면 새 화면이므로 배치 목록을 초기화한다.
  useEffect(() => {
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
      <h1>{room.name} — 참여자 배치</h1>
      {error !== null && <p role="alert">{error}</p>}

      <ul>
        {participants.map((p) => (
          <li key={p.agent_uuid}>
            {p.alias_snapshot ?? p.agent_uuid} {p.persona !== null && `(${p.persona})`}{" "}
            <button type="button" className="outline secondary" onClick={() => removeParticipant(p.agent_uuid)}>
              제거
            </button>
          </li>
        ))}
      </ul>

      <label htmlFor="room-setup-agent-select">에이전트 선택</label>
      <p>
        <button type="button" className="secondary" onClick={onReloadAgents}>
          에이전트 새로고침
        </button>
      </p>
      <select id="room-setup-agent-select" value={selectedUuid} onChange={(e) => setSelectedUuid(e.target.value)}>
        <option value="">에이전트 선택</option>
        {agents.map((a) => (
          <option key={a.uuid} value={a.uuid}>
            {a.meta.alias ?? a.owner.email} ({a.uuid})
          </option>
        ))}
      </select>
      <label htmlFor="room-setup-persona">페르소나(선택)</label>
      <textarea
        id="room-setup-persona"
        style={{ width: "100%", maxWidth: "48rem" }}
        value={persona}
        onChange={(e) => setPersona(e.target.value)}
        rows={3}
        placeholder="페르소나(선택) — 이 에이전트가 room에서 맡을 역할·관점"
      />
      <label htmlFor="room-setup-output-instruction">산출물 지시(선택)</label>
      <input
        id="room-setup-output-instruction"
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
        <>
          <label htmlFor="room-setup-moderator-text">사회자 지시문</label>
          <textarea
            id="room-setup-moderator-text"
            style={{ width: "100%", maxWidth: "48rem" }}
            value={moderatorText}
            onChange={(e) => setModeratorText(e.target.value)}
            rows={6}
          />
        </>
      )}

      <p>
        <button type="button" onClick={startRoom}>
          시작
        </button>
        <button type="button" className="secondary" onClick={onBack}>
          뒤로
        </button>
      </p>
    </section>
  );
}
