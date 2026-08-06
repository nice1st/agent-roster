import type { AgentListItem } from "./types";

export interface AgentsViewProps {
  agents: AgentListItem[];
  loading: boolean;
  error: string | null;
  onReload(): void;
  onChat(uuid: string): void;
}

export function AgentsView({ agents, loading, error, onReload, onChat }: AgentsViewProps) {
  return (
    <section className="view">
      <header className="chat-header">
        <div>
          <h1>에이전트</h1>
          <p className="meta">내가 속한 그룹들에 노출된, 접속 중인 에이전트</p>
        </div>
      </header>
      <div className="view-body">
        <div className="list-head">
          <h2>접속 중 {agents.length}</h2>
          <button type="button" className="secondary" onClick={onReload} disabled={loading}>
            {loading ? "새로고침 중…" : "새로고침"}
          </button>
        </div>
        {error !== null && <p role="alert">{error}</p>}
        <table>
          <caption>에이전트 목록</caption>
          <thead>
            <tr>
              <th scope="col">별칭</th>
              <th scope="col">상태</th>
              <th scope="col">머신</th>
              <th scope="col">소유자</th>
              <th scope="col">UUID</th>
              <th scope="col"> </th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 && (
              <tr>
                <td colSpan={6}>접속 중인 에이전트가 없습니다.</td>
              </tr>
            )}
            {agents.map((a) => (
              <tr key={a.uuid}>
                <td>{a.meta.alias ?? ""}</td>
                <td>{a.meta.status ?? ""}</td>
                <td>{a.meta.machine ?? ""}</td>
                <td>{a.owner.email}</td>
                <td>{a.uuid}</td>
                <td>
                  <button type="button" onClick={() => onChat(a.uuid)}>
                    대화
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
