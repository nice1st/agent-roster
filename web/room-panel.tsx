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
    // 브로커 팬아웃이 발신자를 제외하므로 자기 발언은 스트림으로 돌아오지 않는다 — 여기서 직접 붙인다.
    setMessages((prev) => [...prev, { from: myUuid, message: draft, sentAt: new Date().toISOString() }]);
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
            <strong>{m.from === myUuid ? "me" : (m.fromLabel ?? m.from)}</strong>:{" "}
            <span style={{ whiteSpace: "pre-wrap" }}>{m.message}</span>
          </li>
        ))}
      </ul>

      {initialStatus === "active" && (
        <>
          <input
            style={{ width: "100%", maxWidth: "48rem" }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 한글 IME 조합 중 Enter는 keydown이 두 번 발화한다 — 조합 확정분은 무시해야 중복 발신이 없다.
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
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
