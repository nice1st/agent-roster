// 관리자 화면(03 §2 사용자·그룹 관리) — 사용자 목록(생성·삭제·그룹 부여회수), 그룹 목록(생성·삭제), 초대 안내 복사.
import { useEffect, useState } from "react";

interface AdminUser {
  id: string;
  email: string;
  role: string;
  groupIds: string[];
}

interface AdminGroup {
  id: string;
  name: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`요청 실패: ${url} (${res.status})`);
  return (await res.json()) as T;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function deleteJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "DELETE",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function AdminScreen() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const [usersRes, groupsRes] = await Promise.all([
        getJson<{ users: AdminUser[] }>("/api/admin/users"),
        getJson<{ groups: AdminGroup[] }>("/api/admin/groups"),
      ]);
      setUsers(usersRes.users);
      setGroups(groupsRes.groups);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: 마운트 시 1회만 초기 로드한다.
  useEffect(() => {
    reload();
  }, []);

  async function createUser() {
    if (newUserEmail.trim() === "") return;
    const res = await postJson("/api/admin/users", { email: newUserEmail.trim() });
    if (res.ok) {
      setNewUserEmail("");
      await reload();
    } else {
      setError((await res.json()).error ?? "사용자 생성 실패");
    }
  }

  async function deleteUser(id: string) {
    const res = await deleteJson(`/api/admin/users/${id}`);
    if (res.ok) {
      await reload();
    } else {
      setError((await res.json()).error ?? "사용자 삭제 실패");
    }
  }

  async function createGroup() {
    if (newGroupName.trim() === "") return;
    const res = await postJson("/api/admin/groups", { name: newGroupName.trim() });
    if (res.ok) {
      setNewGroupName("");
      await reload();
    } else {
      setError((await res.json()).error ?? "그룹 생성 실패");
    }
  }

  async function deleteGroup(id: string) {
    const res = await deleteJson(`/api/admin/groups/${id}`);
    if (res.ok) {
      await reload();
    } else {
      setError((await res.json()).error ?? "그룹 삭제 실패");
    }
  }

  async function toggleMembership(userId: string, groupId: string, hasIt: boolean) {
    const res = hasIt
      ? await deleteJson("/api/admin/user-groups", { userId, groupId })
      : await postJson("/api/admin/user-groups", { userId, groupId });
    if (res.ok) {
      await reload();
    } else {
      setError((await res.json()).error ?? "소속 변경 실패");
    }
  }

  async function copyInviteLink() {
    await navigator.clipboard.writeText(window.location.origin);
  }

  return (
    <section>
      <h2>사용자·그룹 관리</h2>
      {error !== null && <p style={{ color: "red" }}>{error}</p>}

      <button type="button" onClick={copyInviteLink}>
        초대 접속 주소 복사
      </button>

      <h3>그룹</h3>
      <ul>
        {groups.map((g) => (
          <li key={g.id}>
            {g.name}{" "}
            <button type="button" onClick={() => deleteGroup(g.id)}>
              삭제
            </button>
          </li>
        ))}
      </ul>
      <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="새 그룹 이름" />
      <button type="button" onClick={createGroup}>
        그룹 생성
      </button>

      <h3>사용자</h3>
      <table>
        <thead>
          <tr>
            <th>email</th>
            <th>role</th>
            <th>그룹</th>
            <th> </th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>
                {groups.map((g) => {
                  const hasIt = u.groupIds.includes(g.id);
                  return (
                    <label key={g.id} style={{ marginRight: "0.5rem" }}>
                      <input type="checkbox" checked={hasIt} onChange={() => toggleMembership(u.id, g.id, hasIt)} />
                      {g.name}
                    </label>
                  );
                })}
              </td>
              <td>
                <button type="button" onClick={() => deleteUser(u.id)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <input value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="새 사용자 email" />
      <button type="button" onClick={createUser}>
        사용자 생성
      </button>
    </section>
  );
}
