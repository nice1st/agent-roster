// group·user_group 저장소 접근 — SQL은 이 모듈 안에만 둔다(05 §4). 스키마는 db/migrations/001-groups.sql.

import type { Database } from "bun:sqlite";

export interface Group {
  id: string;
  name: string;
}

export function createGroupStore(db: Database) {
  return {
    list(): Group[] {
      return db.query<Group, []>("SELECT id, name FROM groups ORDER BY name").all();
    },

    create(name: string): Group {
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO groups (id, name) VALUES (?, ?)").run(id, name);
      return { id, name };
    },

    /** 그룹과 그 user_groups를 함께 지운다(01 §2 — 그룹 삭제 시 소속도 정리). 존재하지 않으면 false. */
    remove(groupId: string): boolean {
      const existing = db.query<{ id: string }, [string]>("SELECT id FROM groups WHERE id = ?").get(groupId);
      if (existing === null) return false;
      db.transaction(() => {
        db.prepare("DELETE FROM user_groups WHERE group_id = ?").run(groupId);
        db.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
      })();
      return true;
    },

    /** userId의 user_groups를 모두 지운다(사용자 삭제 시 소속 정리용). */
    removeAllForUser(userId: string): void {
      db.prepare("DELETE FROM user_groups WHERE user_id = ?").run(userId);
    },

    listGroupIdsForUser(userId: string): string[] {
      return db
        .query<{ group_id: string }, [string]>("SELECT group_id FROM user_groups WHERE user_id = ?")
        .all(userId)
        .map((r) => r.group_id);
    },

    /** user_group 부여 — 이미 있으면 조용히 무시(중복 부여는 무해). */
    grant(userId: string, groupId: string): void {
      db.prepare("INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)").run(userId, groupId);
    },

    /** user_group 회수. */
    revoke(userId: string, groupId: string): void {
      db.prepare("DELETE FROM user_groups WHERE user_id = ? AND group_id = ?").run(userId, groupId);
    },
  };
}

export type GroupStore = ReturnType<typeof createGroupStore>;
