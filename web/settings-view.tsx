import { useState } from "react";
import { AdminScreen } from "./admin";
import { MyAgentPage } from "./my-agent";

export interface SettingsViewProps {
  isAdmin: boolean;
}

type Tab = "my-agent" | "admin";

export function SettingsView({ isAdmin }: SettingsViewProps) {
  const [tab, setTab] = useState<Tab>("my-agent");

  return (
    <section>
      <h1>설정</h1>
      {isAdmin && (
        <nav>
          <button
            type="button"
            className={tab === "my-agent" ? undefined : "secondary"}
            onClick={() => setTab("my-agent")}
          >
            내 에이전트
          </button>
          <button type="button" className={tab === "admin" ? undefined : "secondary"} onClick={() => setTab("admin")}>
            관리자
          </button>
        </nav>
      )}
      {tab === "my-agent" && <MyAgentPage />}
      {tab === "admin" && isAdmin && <AdminScreen />}
    </section>
  );
}
