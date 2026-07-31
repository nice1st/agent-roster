import { useState } from "react";

interface AgentMeta {
  machine?: string;
  cwd?: string;
  alias?: string;
  status?: string;
}

interface AgentListItem {
  uuid: string;
  meta: AgentMeta;
  owner: { email: string };
}

export interface AgentsPageProps {
  onBack: () => void;
  onChat: (uuid: string, label: string) => void;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`요청 실패: ${url} (${res.status})`);
  return (await res.json()) as T;
}

export function AgentsPage({ onBack, onChat }: AgentsPageProps) {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const res = await getJson<{ agents: AgentListItem[] }>("/api/agents");
      setAgents(res.agents);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>에이전트 목록</h1>
      <p>내가 속한 그룹들에 노출된, 접속 중인 에이전트다.</p>
      {error !== null && <p role="alert">{error}</p>}
      <button type="button" onClick={reload} disabled={loading}>
        {loading ? "새로고침 중…" : "새로고침"}
      </button>
      <table>
        <caption>에이전트 목록</caption>
        <thead>
          <tr>
            <th scope="col">alias</th>
            <th scope="col">status</th>
            <th scope="col">machine</th>
            <th scope="col">owner</th>
            <th scope="col">uuid</th>
            <th scope="col"> </th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.uuid}>
              <td>{a.meta.alias ?? ""}</td>
              <td>{a.meta.status ?? ""}</td>
              <td>{a.meta.machine ?? ""}</td>
              <td>{a.owner.email}</td>
              <td>{a.uuid}</td>
              <td>
                <button type="button" onClick={() => onChat(a.uuid, a.meta.alias ?? a.owner.email)}>
                  대화
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <button type="button" onClick={onBack}>
          뒤로
        </button>
      </p>
    </main>
  );
}
