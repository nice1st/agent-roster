// EventSource는 GET+쿠키만 지원하고, SSE 프레임에 event: 필드가 없어 기본 message 이벤트로 온다.
import { useEffect, useRef, useState } from "react";

interface ChatMessage {
  from: string;
  message: string;
  sentAt: string;
}

export interface ChatPanelProps {
  peerUuid: string;
  peerLabel: string;
  onClose: () => void;
}

type ConnectionState = "connecting" | "open" | "disconnected";

export function ChatPanel({ peerUuid, peerLabel, onClose }: ChatPanelProps) {
  const [myUuid, setMyUuid] = useState<string | null>(null);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const myUuidRef = useRef<string | null>(null);

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
        from?: string;
        message?: string;
        sent_at?: string;
        error?: string;
      };
      if (data.type === "registered" && data.uuid !== undefined) {
        myUuidRef.current = data.uuid;
        setMyUuid(data.uuid);
        setState("open");
      } else if (data.type === "message" && data.from !== undefined && data.message !== undefined) {
        setMessages((prev) => [
          ...prev,
          { from: data.from as string, message: data.message as string, sentAt: data.sent_at ?? "" },
        ]);
      } else if (data.type === "error") {
        setError(data.error ?? "스트림 오류");
      }
    };
    source.onerror = () => {
      setState("disconnected");
    };
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: peerUuid가 바뀌면 새 대화이므로 재연결한다.
  useEffect(() => {
    connect();
    return () => {
      sourceRef.current?.close();
    };
  }, [peerUuid]);

  function reconnect() {
    sourceRef.current?.close();
    connect(myUuidRef.current ?? undefined);
  }

  async function send() {
    if (myUuid === null || draft.trim() === "") return;
    const res = await fetch("/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: myUuid, to: peerUuid, message: draft }),
    });
    const body = (await res.json()) as { ok: boolean; error?: string };
    if (!body.ok) {
      setError(body.error ?? "전송 실패");
      return;
    }
    setMessages((prev) => [...prev, { from: myUuid, message: draft, sentAt: new Date().toISOString() }]);
    setDraft("");
  }

  return (
    <main>
      <h1>{peerLabel}와 대화</h1>
      <p role="note">1:1 대화는 기록되지 않습니다 — 새로고침하면 사라집니다.</p>
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
          // biome-ignore lint/suspicious/noArrayIndexKey: 기록되지 않는 화면용 로그라 인덱스로 충분하다.
          <li key={i}>
            <strong>{m.from === myUuid ? "me" : m.from}</strong>:{" "}
            <span style={{ whiteSpace: "pre-wrap" }}>{m.message}</span>
          </li>
        ))}
      </ul>

      <input
        style={{ width: "100%", maxWidth: "48rem" }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // 한글 IME 조합 중 Enter는 keydown이 두 번 발화한다 — 조합 확정분은 무시해야 중복 발신이 없다.
          if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
        }}
        disabled={myUuid === null}
        placeholder="메시지 입력"
      />
      <button type="button" onClick={send} disabled={myUuid === null}>
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
