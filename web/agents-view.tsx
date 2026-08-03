import type { AgentListItem } from "./types";

export interface AgentsViewProps {
  agents: AgentListItem[];
  loading: boolean;
  error: string | null;
  onReload(): void;
  onChat(uuid: string, label: string): void;
}

export function AgentsView({ agents, loading, error, onReload, onChat }: AgentsViewProps) {
  return (
    <section>
      <h1>에이전트 목록</h1>
      <p>내가 속한 그룹들에 노출된, 접속 중인 에이전트다.</p>
      {error !== null && <p role="alert">{error}</p>}
      <button type="button" className="secondary" onClick={onReload} disabled={loading}>
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
    </section>
  );
}
