// room 대화 화면(03 §2 "room", 05 §2 #13) — 웹 세션 uuid로 /api/chat/stream을 열고(기존 스트림 재사용,
// 프레임의 room 필드로 구분), 그 uuid를 watch로 등록해 room-message를 받는다. 입력창으로 /room-send(from=웹 uuid).
import { useEffect, useRef, useState } from "react";

interface RoomChatMessage {
  from: string;
  fromLabel?: string;
  message: string;
  sentAt: string;
}

export interface RoomPanelProps {
  roomId: string;
  roomName: string;
  onClose: () => void;
}

type ConnectionState = "connecting" | "open" | "disconnected";

export function RoomPanel({ roomId, roomName, onClose }: RoomPanelProps) {
  const [myUuid, setMyUuid] = useState<string | null>(null);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: roomId가 바뀌면 새 room이므로 재연결한다.
  useEffect(() => {
    connect();
    return () => {
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
      <p role="note">room 대화는 기록됩니다.</p>
      {ended && <p role="alert">이 room은 종료됐습니다. 더 이상 발언할 수 없습니다.</p>}
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

      <ul>
        {messages.map((m, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 스트림 도착 순서 그대로 보여주는 화면용 로그다.
          <li key={i}>
            <strong>{m.from === myUuid ? "me" : (m.fromLabel ?? m.from)}</strong>: {m.message}
          </li>
        ))}
      </ul>

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

      <p>
        <button type="button" onClick={onClose}>
          뒤로
        </button>
      </p>
    </main>
  );
}
