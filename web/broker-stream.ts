// EventSource는 GET+쿠키만 지원하고, SSE 프레임에 event: 필드가 없어 기본 message 이벤트로 온다.
import { useEffect, useRef, useState } from "react";

export type ConnectionState = "connecting" | "open" | "disconnected";

const STORAGE_KEY = "roster-web-uuid";

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface BrokerStreamHandlers {
  onMessage(from: string, message: string, sentAt: string, skill?: string): void;
  onRoomMessage(room: string, from: string, fromLabel: string | undefined, message: string, sentAt: string): void;
  onRoomEnd(room: string): void;
  onError?(error: string): void;
  // 재연결 직후 다시 watch를 걸어야 할 room id 목록 — 최신 상태를 반영해야 하므로 콜백으로 받는다.
  getOpenRoomIds(): string[];
}

export interface BrokerStream {
  myUuid: string | null;
  state: ConnectionState;
  reconnect(): void;
  watchRoom(roomId: string): Promise<void>;
  sendDirect(to: string, message: string): Promise<SendResult>;
  sendRoom(roomId: string, message: string): Promise<SendResult>;
}

export function useBrokerStream(handlers: BrokerStreamHandlers): BrokerStream {
  const [myUuid, setMyUuid] = useState<string | null>(null);
  const [state, setState] = useState<ConnectionState>("connecting");
  const sourceRef = useRef<EventSource | null>(null);
  const myUuidRef = useRef<string | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  async function watchRoom(roomId: string): Promise<void> {
    const uuid = myUuidRef.current;
    if (uuid === null) return;
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
        skill?: string;
        error?: string;
      };
      if (data.type === "registered" && data.uuid !== undefined) {
        myUuidRef.current = data.uuid;
        sessionStorage.setItem(STORAGE_KEY, data.uuid);
        setMyUuid(data.uuid);
        setState("open");
        // 브로커의 room 구독은 전달 실패 시 지워지는 lazy 정리라, 재연결 직후 다시 걸어야 한다.
        for (const roomId of handlersRef.current.getOpenRoomIds()) {
          watchRoom(roomId);
        }
      } else if (data.type === "message" && data.from !== undefined && data.message !== undefined) {
        handlersRef.current.onMessage(data.from, data.message, data.sent_at ?? "", data.skill);
      } else if (data.type === "room-message" && data.room !== undefined && data.from !== undefined) {
        handlersRef.current.onRoomMessage(
          data.room,
          data.from,
          data.from_label,
          data.message ?? "",
          data.sent_at ?? "",
        );
      } else if (data.type === "room-end" && data.room !== undefined) {
        handlersRef.current.onRoomEnd(data.room);
      } else if (data.type === "error") {
        handlersRef.current.onError?.(data.error ?? "스트림 오류");
      }
    };
    source.onerror = () => {
      // EventSource 기본 재연결을 그대로 두면 uuid 없는 URL로 다시 붙어 새 UUID를 받는다 — close()로 막고 수동 재연결만 허용한다.
      source.close();
      setState("disconnected");
    };
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: 세션 전체에서 연결은 하나뿐이라 마운트 시 1회만 연결한다.
  useEffect(() => {
    connect(sessionStorage.getItem(STORAGE_KEY) ?? undefined);
    return () => {
      sourceRef.current?.close();
    };
  }, []);

  function reconnect() {
    sourceRef.current?.close();
    connect(myUuidRef.current ?? sessionStorage.getItem(STORAGE_KEY) ?? undefined);
  }

  async function sendDirect(to: string, message: string): Promise<SendResult> {
    const from = myUuidRef.current;
    if (from === null) return { ok: false, error: "연결되지 않았습니다" };
    const res = await fetch("/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to, message }),
    });
    return (await res.json()) as SendResult;
  }

  async function sendRoom(roomId: string, message: string): Promise<SendResult> {
    const from = myUuidRef.current;
    if (from === null) return { ok: false, error: "연결되지 않았습니다" };
    const res = await fetch("/room-send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, room: roomId, message }),
    });
    return (await res.json()) as SendResult;
  }

  return { myUuid, state, reconnect, watchRoom, sendDirect, sendRoom };
}
