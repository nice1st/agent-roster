import { jwtClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";

const authClient = createAuthClient({ plugins: [jwtClient()] });

interface AgentMeta {
  machine?: string;
  cwd?: string;
  alias?: string;
  status?: string;
}

interface MyAgentListItem {
  uuid: string;
  meta: AgentMeta;
}

export function MyAgentPage() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [myAgents, setMyAgents] = useState<MyAgentListItem[]>([]);
  const [listError, setListError] = useState<string | null>(null);

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

  async function reloadMyAgents() {
    try {
      const res = await fetch("/api/my-agents");
      if (!res.ok) throw new Error(`요청 실패: /api/my-agents (${res.status})`);
      const body = (await res.json()) as { agents: MyAgentListItem[] };
      setMyAgents(body.agents);
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: 마운트 시 1회만 초기 로드한다.
  useEffect(() => {
    reloadMyAgents();
  }, []);

  return (
    <section>
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
          <label htmlFor="my-agent-token">발급된 토큰</label>
          <textarea id="my-agent-token" readOnly value={token} rows={4} style={{ width: "100%" }} />
          <button type="button" className="secondary" onClick={copyToken}>
            클립보드에 복사
          </button>
          {copied && <span> 복사됨</span>}
        </div>
      )}

      <h2>접속 중인 내 에이전트</h2>
      {listError !== null && <p role="alert">{listError}</p>}
      <button type="button" className="secondary" onClick={reloadMyAgents}>
        새로고침
      </button>
      <table>
        <caption>접속 중인 내 에이전트</caption>
        <thead>
          <tr>
            <th scope="col">alias</th>
            <th scope="col">status</th>
            <th scope="col">machine</th>
            <th scope="col">uuid</th>
          </tr>
        </thead>
        <tbody>
          {myAgents.map((a) => (
            <tr key={a.uuid}>
              <td>{a.meta.alias ?? ""}</td>
              <td>{a.meta.status ?? ""}</td>
              <td>{a.meta.machine ?? ""}</td>
              <td>{a.uuid}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
