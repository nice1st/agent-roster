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

    remove(groupId: string): boolean {
      const existing = db.query<{ id: string }, [string]>("SELECT id FROM groups WHERE id = ?").get(groupId);
      if (existing === null) return false;
      db.transaction(() => {
        db.prepare("DELETE FROM user_groups WHERE group_id = ?").run(groupId);
        db.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
      })();
      return true;
    },

    removeAllForUser(userId: string): void {
      db.prepare("DELETE FROM user_groups WHERE user_id = ?").run(userId);
    },

    listGroupIdsForUser(userId: string): string[] {
      return db
        .query<{ group_id: string }, [string]>("SELECT group_id FROM user_groups WHERE user_id = ?")
        .all(userId)
        .map((r) => r.group_id);
    },

    getGroupsForUser(userId: string): Group[] {
      return db
        .query<Group, [string]>(
          "SELECT g.id AS id, g.name AS name FROM groups g JOIN user_groups ug ON ug.group_id = g.id WHERE ug.user_id = ? ORDER BY g.name",
        )
        .all(userId);
    },

    grant(userId: string, groupId: string): void {
      db.prepare("INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)").run(userId, groupId);
    },

    revoke(userId: string, groupId: string): void {
      db.prepare("DELETE FROM user_groups WHERE user_id = ? AND group_id = ?").run(userId, groupId);
    },
  };
}

export type GroupStore = ReturnType<typeof createGroupStore>;
