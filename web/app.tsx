// 로그인 화면 최소본(03 §2) — Google 로그인, 로그인 후 세션(email) 표시·로그아웃.
// better-auth react 클라이언트는 web/에서만 쓴다 — 서버 쪽 Better Auth 접점은 src/auth/ 격리(02 §2).
import { createAuthClient } from "better-auth/react";
import { useState } from "react";
import { AdminScreen } from "./admin";
import { AgentsPage } from "./agents";
import { ChatPanel } from "./chat";
import { MyAgentPage } from "./my-agent";
import { RoomPanel } from "./room-panel";
import { RoomsPage } from "./rooms";

const authClient = createAuthClient();

type Screen = "home" | "my-agent" | "agents" | "rooms";

export function App() {
  const { data: session, isPending } = authClient.useSession();
  const [screen, setScreen] = useState<Screen>("home");
  const [chatTarget, setChatTarget] = useState<{ uuid: string; label: string } | null>(null);
  const [roomTarget, setRoomTarget] = useState<{ id: string; name: string; status: "active" | "ended" } | null>(null);

  if (isPending) {
    return <p>세션 확인 중…</p>;
  }

  if (session === null) {
    return (
      <main>
        <h1>agent-orchestra</h1>
        <p>초대된 계정만 로그인할 수 있다.</p>
        <button type="button" onClick={() => authClient.signIn.social({ provider: "google" })}>
          Google로 로그인
        </button>
      </main>
    );
  }

  if (chatTarget !== null) {
    return <ChatPanel peerUuid={chatTarget.uuid} peerLabel={chatTarget.label} onClose={() => setChatTarget(null)} />;
  }

  if (roomTarget !== null) {
    return (
      <RoomPanel
        roomId={roomTarget.id}
        roomName={roomTarget.name}
        initialStatus={roomTarget.status}
        onClose={() => setRoomTarget(null)}
      />
    );
  }

  if (screen === "my-agent") {
    return <MyAgentPage onBack={() => setScreen("home")} />;
  }

  if (screen === "agents") {
    return <AgentsPage onBack={() => setScreen("home")} onChat={(uuid, label) => setChatTarget({ uuid, label })} />;
  }

  if (screen === "rooms") {
    return (
      <RoomsPage
        onBack={() => setScreen("home")}
        onOpenRoom={(id, name, status) => setRoomTarget({ id, name, status })}
      />
    );
  }

  return (
    <main>
      <h1>agent-orchestra</h1>
      <p>{session.user.email}</p>
      <button type="button" onClick={() => setScreen("my-agent")}>
        내 에이전트
      </button>
      <button type="button" onClick={() => setScreen("agents")}>
        에이전트 목록
      </button>
      <button type="button" onClick={() => setScreen("rooms")}>
        room
      </button>
      <button type="button" onClick={() => authClient.signOut()}>
        로그아웃
      </button>
      {(session.user as { role?: string }).role === "admin" && <AdminScreen />}
    </main>
  );
}
