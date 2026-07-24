// 로그인 화면 최소본(03 §2) — Google 로그인, 로그인 후 세션(email) 표시·로그아웃.
// better-auth react 클라이언트는 web/에서만 쓴다 — 서버 쪽 Better Auth 접점은 src/auth/ 격리(02 §2).
import { createAuthClient } from "better-auth/react";
import { useState } from "react";
import { AdminScreen } from "./admin";
import { AgentsPage } from "./agents";
import { ChatPanel } from "./chat";
import { MyAgentPage } from "./my-agent";
import { RoomsPage } from "./rooms";

const authClient = createAuthClient();

type Screen = "home" | "my-agent" | "agents" | "rooms";

export function App() {
  const { data: session, isPending } = authClient.useSession();
  const [screen, setScreen] = useState<Screen>("home");
  const [chatTarget, setChatTarget] = useState<{ uuid: string; label: string } | null>(null);

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

  if (screen === "my-agent") {
    return <MyAgentPage onBack={() => setScreen("home")} />;
  }

  if (screen === "agents") {
    return <AgentsPage onBack={() => setScreen("home")} onChat={(uuid, label) => setChatTarget({ uuid, label })} />;
  }

  if (screen === "rooms") {
    // active room 대화 화면은 슬라이스 13에서 붙인다 — 지금은 room 관리(draft 배치·시작)까지.
    return <RoomsPage onBack={() => setScreen("home")} onOpenRoom={() => {}} />;
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
