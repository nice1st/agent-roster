// room 대화·기록 화면(03 §2 "room", 05 §2 #13·#15). active room은 GET /api/rooms/:id/messages로 기존 기록을
// 백필한 뒤 /api/chat/stream(SSE)을 열어 실시간 이어붙임(프레임의 room 필드로 구분), watch로 room-message를 받는다.
// 입력창으로 /room-send(from=웹 uuid). ended room은 SSE 연결 없이 참여자 + 발언 로그만 조회한다(01 §5 기록 보존).
import { useEffect, useRef, useState } from "react";

interface RoomChatMessage {
  id?: number;
  from: string;
  fromLabel?: string;
  message: string;
  sentAt: string;
}

interface RoomParticipantItem {
  agent_uuid: string;
  alias_snapshot: string | null;
  persona: string | null;
}

export interface RoomPanelProps {
  roomId: string;
  roomName: string;
  /** 목록 화면에서 넘어온 room 상태 — ended면 SSE를 열지 않고 기록 조회만 한다(05 §2 #15). */
  initialStatus: "active" | "ended";
  onClose: () => void;
}

type ConnectionState = "connecting" | "open" | "disconnected";

async function fetchMessages(
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

export function RoomPanel({ roomId, roomName, initialStatus, onClose }: RoomPanelProps) {
  const [myUuid, setMyUuid] = useState<string | null>(null);
  const [state, setState] = useState<ConnectionState>(initialStatus === "ended" ? "open" : "connecting");
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [participants, setParticipants] = useState<RoomParticipantItem[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(initialStatus === "ended");
  const sourceRef = useRef<EventSource | null>(null);
  const myUuidRef = useRef<string | null>(null);

  async function watch(uuid: string) {
    await fetch(`/api/rooms/${roomId}/watch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uuid }),
    });
  }

  function connect(resumeUuid?: string) {
    setState("connecting");
    const url = new URL("/api/chat/stream", window.location.origin);
    if (resumeUuid !== undefined) url.searchParams.set("uuid", resumeUuid);
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as {
        type: string;
        uuid?: string;
        room?: string;
        from?: string;
        from_label?: string;
        message?: string;
        sent_at?: string;
        error?: string;
      };
      if (data.type === "registered" && data.uuid !== undefined) {
        myUuidRef.current = data.uuid;
        setMyUuid(data.uuid);
        setState("open");
        watch(data.uuid);
      } else if (data.type === "room-message" && data.room === roomId && data.from !== undefined) {
        setMessages((prev) => [
          ...prev,
          {
            from: data.from as string,
            fromLabel: data.from_label,
            message: data.message ?? "",
            sentAt: data.sent_at ?? "",
          },
        ]);
      } else if (data.type === "room-end" && data.room === roomId) {
        setEnded(true);
      } else if (data.type === "error") {
        setError(data.error ?? "스트림 오류");
      }
    };
    source.onerror = () => {
      setState("disconnected");
    };
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: roomId가 바뀌면 새 room이므로 재로드·재연결한다.
  useEffect(() => {
    let cancelled = false;
    fetchMessages(roomId)
      .then((backfill) => {
        if (cancelled) return;
        setMessages(backfill.messages);
        setParticipants(backfill.participants);
        // 백필 이후에만 SSE를 연다 — active room만, ended면 기록 조회로 끝낸다(05 §2 #15).
        if (initialStatus === "active") connect();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      cancelled = true;
      const uuid = myUuidRef.current;
      sourceRef.current?.close();
      if (uuid !== null) {
        fetch(`/api/rooms/${roomId}/watch`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uuid }),
        }).catch(() => {});
      }
    };
  }, [roomId]);

  function reconnect() {
    sourceRef.current?.close();
    connect(myUuidRef.current ?? undefined);
  }

  async function send() {
    if (myUuid === null || draft.trim() === "") return;
    const res = await fetch("/room-send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: myUuid, room: roomId, message: draft }),
    });
    const body = (await res.json()) as { ok: boolean; error?: string };
    if (!body.ok) {
      setError(body.error ?? "전송 실패");
      return;
    }
    setDraft("");
  }

  return (
    <main>
      <h1>room: {roomName}</h1>
      {initialStatus === "ended" ? (
        <p role="note">이 room은 종료됐습니다. 기록만 조회할 수 있습니다.</p>
      ) : (
        <p role="note">room 대화는 기록됩니다.</p>
      )}
      {ended && initialStatus === "active" && (
        <p role="alert">이 room이 방금 종료됐습니다. 더 이상 발언할 수 없습니다.</p>
      )}
      {state === "disconnected" && (
        <p role="alert">
          연결이 끊겼습니다.{" "}
          <button type="button" onClick={reconnect}>
            재연결
          </button>
        </p>
      )}
      {state === "connecting" && <p>연결 중…</p>}
      {error !== null && <p role="alert">{error}</p>}

      <section>
        <h2>참여자</h2>
        <ul>
          {participants.map((p) => (
            <li key={p.agent_uuid}>
              {p.alias_snapshot ?? p.agent_uuid} {p.persona !== null && `(${p.persona})`}
            </li>
          ))}
        </ul>
      </section>

      <ul>
        {messages.map((m, i) => (
          <li key={m.id ?? `stream-${i}`}>
            <strong>{m.from === myUuid ? "me" : (m.fromLabel ?? m.from)}</strong>: {m.message}
          </li>
        ))}
      </ul>

      {initialStatus === "active" && (
        <>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            disabled={myUuid === null || ended}
            placeholder="메시지 입력"
          />
          <button type="button" onClick={send} disabled={myUuid === null || ended}>
            전송
          </button>
        </>
      )}

      <p>
        <button type="button" onClick={onClose}>
          뒤로
        </button>
      </p>
    </main>
  );
}
