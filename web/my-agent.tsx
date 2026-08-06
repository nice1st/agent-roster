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
      setError("토큰 발급에 실패했습니다 — 로그인 상태를 확인하세요.");
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
      <h2>등록 토큰</h2>
      <p>
        발급한 토큰을 에이전트 플러그인의 env <code>BROKER_TOKEN</code>에 넣으세요.
      </p>
      <button type="button" onClick={issueToken}>
        토큰 발급
      </button>
      {error !== null && <p role="alert">{error}</p>}
      {token !== null && (
        <div>
          <label htmlFor="my-agent-token">발급된 토큰</label>
          <textarea id="my-agent-token" readOnly value={token} rows={4} />
          <button type="button" className="secondary" onClick={copyToken}>
            {copied ? "복사됨" : "클립보드에 복사"}
          </button>
        </div>
      )}

      <div className="list-head">
        <h2>접속 중인 내 에이전트</h2>
        <button type="button" className="secondary" onClick={reloadMyAgents}>
          새로고침
        </button>
      </div>
      {listError !== null && <p role="alert">{listError}</p>}
      <table>
        <caption>접속 중인 내 에이전트</caption>
        <thead>
          <tr>
            <th scope="col">별칭</th>
            <th scope="col">상태</th>
            <th scope="col">머신</th>
            <th scope="col">UUID</th>
          </tr>
        </thead>
        <tbody>
          {myAgents.length === 0 && (
            <tr>
              <td colSpan={4}>접속 중인 에이전트가 없습니다.</td>
            </tr>
          )}
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
