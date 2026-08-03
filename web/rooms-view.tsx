import { useState } from "react";
import type { RoomListItem } from "./types";

const DEFAULT_MODERATOR_NOTICE = `진행 안내: 이 room은 사회자가 진행한다.
주제 제시와 다음 발언자 지정은 사회자가 하며, 사회자의 지정을 받았을 때 발언하라.`;

export interface CreateRoomPayload {
  name: string;
  context?: string;
  duration_minutes?: number;
  moderator_required?: true;
}

export interface RoomsViewProps {
  rooms: RoomListItem[];
  loading: boolean;
  onReload(): void;
  onCreateRoom(payload: CreateRoomPayload): Promise<{ ok: boolean; error?: string }>;
  onOpenRoom(id: string): void;
  onEndRoom(id: string): void;
}

export function RoomsView({ rooms, loading, onReload, onCreateRoom, onOpenRoom, onEndRoom }: RoomsViewProps) {
  const [newName, setNewName] = useState("");
  const [newContext, setNewContext] = useState("");
  const [newDuration, setNewDuration] = useState("");
  const [newModeratorRequired, setNewModeratorRequired] = useState(false);
  const [newModeratorNotice, setNewModeratorNotice] = useState(DEFAULT_MODERATOR_NOTICE);
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    if (newName.trim() === "") return;
    const durationMinutes = newDuration.trim() === "" ? undefined : Number(newDuration);
    // 사회자 안내문은 별도 필드가 아니라 context에 합쳐 저장한다 — 참여자는 room-start의 context로 받는다.
    const notice = newModeratorRequired ? newModeratorNotice.trim() : "";
    const context = [newContext.trim(), notice].filter((s) => s !== "").join("\n\n");
    const result = await onCreateRoom({
      name: newName.trim(),
      context: context === "" ? undefined : context,
      duration_minutes: durationMinutes,
      moderator_required: newModeratorRequired ? true : undefined,
    });
    if (result.ok) {
      setNewName("");
      setNewContext("");
      setNewDuration("");
      setNewModeratorRequired(false);
      setNewModeratorNotice(DEFAULT_MODERATOR_NOTICE);
      setError(null);
    } else {
      setError(result.error ?? "room 생성 실패");
    }
  }

  return (
    <section>
      <h1>room</h1>
      {error !== null && <p role="alert">{error}</p>}

      <section>
        <h2>새 room 만들기</h2>
        <label htmlFor="room-new-name">이름</label>
        <input id="room-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="이름" />
        <label htmlFor="room-new-context">컨텍스트(선택)</label>
        <textarea
          id="room-new-context"
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
        <label htmlFor="room-new-duration">지속 시간(분, 비우면 무제한)</label>
        <input
          id="room-new-duration"
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
          <>
            <label htmlFor="room-new-moderator-notice">사회자 안내문</label>
            <textarea
              id="room-new-moderator-notice"
              style={{ width: "100%", maxWidth: "48rem" }}
              value={newModeratorNotice}
              onChange={(e) => setNewModeratorNotice(e.target.value)}
              rows={3}
            />
          </>
        )}
        <button type="button" onClick={createRoom}>
          생성
        </button>
      </section>

      <section>
        <h2>내 room 목록</h2>
        <button type="button" className="secondary" onClick={onReload} disabled={loading}>
          {loading ? "새로고침 중…" : "새로고침"}
        </button>
        <table>
          <caption>내 room 목록</caption>
          <thead>
            <tr>
              <th scope="col">이름</th>
              <th scope="col">상태</th>
              <th scope="col">종료 시각</th>
              <th scope="col"> </th>
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
                    <button type="button" className="secondary" onClick={() => onOpenRoom(r.id)}>
                      설정
                    </button>
                  )}
                  {r.status === "active" && (
                    <>
                      <button type="button" className="secondary" onClick={() => onOpenRoom(r.id)}>
                        열기
                      </button>
                      <button type="button" className="outline contrast" onClick={() => onEndRoom(r.id)}>
                        종료
                      </button>
                    </>
                  )}
                  {r.status === "ended" && (
                    <button type="button" className="secondary" onClick={() => onOpenRoom(r.id)}>
                      기록 보기
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}
