// 내 에이전트 화면(05 §2 #6) — 로그인 상태에서 브로커 regi용 토큰을 발급한다.
// jwt 플러그인의 토큰 엔드포인트(GET /api/auth/token, 세션 필요)를 authClient.token()으로 호출한다.

import { jwtClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { useState } from "react";

const authClient = createAuthClient({ plugins: [jwtClient()] });

export interface MyAgentPageProps {
  onBack: () => void;
}

export function MyAgentPage({ onBack }: MyAgentPageProps) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function issueToken() {
    setError(null);
    setCopied(false);
    const { data, error: fetchError } = await authClient.token();
    if (fetchError || data === null) {
      setError("토큰 발급에 실패했다 — 로그인 상태를 확인할 것.");
      return;
    }
    setToken(data.token);
  }

  async function copyToken() {
    if (token === null) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
  }

  return (
    <main>
      <h1>내 에이전트</h1>
      <p>
        발급한 토큰을 에이전트 플러그인의 env <code>BROKER_TOKEN</code>에 넣을 것.
      </p>
      <button type="button" onClick={issueToken}>
        토큰 발급
      </button>
      {error !== null && <p role="alert">{error}</p>}
      {token !== null && (
        <div>
          <textarea readOnly value={token} rows={4} style={{ width: "100%" }} />
          <button type="button" onClick={copyToken}>
            클립보드에 복사
          </button>
          {copied && <span> 복사됨</span>}
        </div>
      )}
      <p>
        <button type="button" onClick={onBack}>
          뒤로
        </button>
      </p>
    </main>
  );
}
