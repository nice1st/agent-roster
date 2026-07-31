import type { Database } from "bun:sqlite";

export type RoomStatus = "draft" | "active" | "ended";

export interface Room {
  id: string;
  name: string;
  context: string | null;
  status: RoomStatus;
  duration_minutes: number;
  ends_at: string | null;
  created_by: string;
  created_at: string;
  moderator_required: boolean;
  moderator_instruction: string | null;
}

interface RoomRow extends Omit<Room, "moderator_required"> {
  moderator_required: number;
}

function toRoom(row: RoomRow): Room {
  return { ...row, moderator_required: row.moderator_required !== 0 };
}

export interface RoomParticipant {
  room_id: string;
  agent_uuid: string;
  alias_snapshot: string | null;
  persona: string | null;
  output_instruction: string | null;
}

export interface Message {
  id: number; // rowid
  room_id: string;
  from_uuid: string;
  from_label: string | null;
  content: string;
  sent_at: string;
}

export function createRoomStore(db: Database) {
  return {
    create(
      createdBy: string,
      name: string,
      context: string | undefined,
      durationMinutes: number,
      moderatorRequired = false,
      moderatorInstruction?: string,
    ): Room {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(
        "INSERT INTO rooms (id, name, context, status, duration_minutes, ends_at, created_by, created_at, moderator_required, moderator_instruction) VALUES (?, ?, ?, 'draft', ?, NULL, ?, ?, ?, ?)",
      ).run(
        id,
        name,
        context ?? null,
        durationMinutes,
        createdBy,
        createdAt,
        moderatorRequired ? 1 : 0,
        moderatorInstruction ?? null,
      );
      return {
        id,
        name,
        context: context ?? null,
        status: "draft",
        duration_minutes: durationMinutes,
        ends_at: null,
        created_by: createdBy,
        created_at: createdAt,
        moderator_required: moderatorRequired,
        moderator_instruction: moderatorInstruction ?? null,
      };
    },

    get(roomId: string): Room | null {
      const row = db.query<RoomRow, [string]>("SELECT * FROM rooms WHERE id = ?").get(roomId);
      return row === null ? null : toRoom(row);
    },

    listForUser(userId: string): Room[] {
      return db
        .query<RoomRow, [string]>("SELECT * FROM rooms WHERE created_by = ? ORDER BY created_at DESC")
        .all(userId)
        .map(toRoom);
    },

    start(roomId: string): void {
      const room = this.get(roomId);
      if (room === null) return;
      const endsAt = room.duration_minutes > 0 ? minutesFromNow(room.duration_minutes) : null;
      db.prepare("UPDATE rooms SET status = 'active', ends_at = ? WHERE id = ?").run(endsAt, roomId);
    },

    setDuration(roomId: string, durationMinutes: number): void {
      const endsAt = durationMinutes > 0 ? minutesFromNow(durationMinutes) : null;
      db.prepare("UPDATE rooms SET duration_minutes = ?, ends_at = ? WHERE id = ?").run(
        durationMinutes,
        endsAt,
        roomId,
      );
    },

    end(roomId: string): void {
      db.prepare("UPDATE rooms SET status = 'ended' WHERE id = ?").run(roomId);
    },

    listExpired(nowIso: string): Room[] {
      return db
        .query<RoomRow, [string]>(
          "SELECT * FROM rooms WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ?",
        )
        .all(nowIso)
        .map(toRoom);
    },

    addParticipant(
      roomId: string,
      agentUuid: string,
      aliasSnapshot: string | undefined,
      persona: string | undefined,
      outputInstruction: string | undefined,
    ): void {
      db.prepare(
        "INSERT INTO room_participants (room_id, agent_uuid, alias_snapshot, persona, output_instruction) VALUES (?, ?, ?, ?, ?)",
      ).run(roomId, agentUuid, aliasSnapshot ?? null, persona ?? null, outputInstruction ?? null);
    },

    updateParticipantPersona(roomId: string, agentUuid: string, persona: string): boolean {
      const existing = db
        .query<{ room_id: string }, [string, string]>(
          "SELECT room_id FROM room_participants WHERE room_id = ? AND agent_uuid = ?",
        )
        .get(roomId, agentUuid);
      if (existing === null) return false;
      db.prepare("UPDATE room_participants SET persona = ? WHERE room_id = ? AND agent_uuid = ?").run(
        persona,
        roomId,
        agentUuid,
      );
      return true;
    },

    removeParticipant(roomId: string, agentUuid: string): boolean {
      const existing = db
        .query<{ room_id: string }, [string, string]>(
          "SELECT room_id FROM room_participants WHERE room_id = ? AND agent_uuid = ?",
        )
        .get(roomId, agentUuid);
      if (existing === null) return false;
      db.prepare("DELETE FROM room_participants WHERE room_id = ? AND agent_uuid = ?").run(roomId, agentUuid);
      return true;
    },

    listParticipants(roomId: string): RoomParticipant[] {
      return db.query<RoomParticipant, [string]>("SELECT * FROM room_participants WHERE room_id = ?").all(roomId);
    },

    isParticipant(roomId: string, agentUuid: string): boolean {
      const row = db
        .query<{ room_id: string }, [string, string]>(
          "SELECT room_id FROM room_participants WHERE room_id = ? AND agent_uuid = ?",
        )
        .get(roomId, agentUuid);
      return row !== null;
    },

    addMessage(roomId: string, fromUuid: string, fromLabel: string | undefined, content: string): Message {
      const sentAt = new Date().toISOString();
      const result = db
        .prepare("INSERT INTO messages (room_id, from_uuid, from_label, content, sent_at) VALUES (?, ?, ?, ?, ?)")
        .run(roomId, fromUuid, fromLabel ?? null, content, sentAt);
      return {
        id: Number(result.lastInsertRowid),
        room_id: roomId,
        from_uuid: fromUuid,
        from_label: fromLabel ?? null,
        content,
        sent_at: sentAt,
      };
    },

    listMessages(roomId: string): Message[] {
      return db
        .query<Message, [string]>(
          "SELECT rowid AS id, room_id, from_uuid, from_label, content, sent_at FROM messages WHERE room_id = ? ORDER BY rowid",
        )
        .all(roomId);
    },

    listMessagesAfter(roomId: string, after: number, limit: number): Message[] {
      return db
        .query<Message, [string, number, number]>(
          "SELECT rowid AS id, room_id, from_uuid, from_label, content, sent_at FROM messages WHERE room_id = ? AND rowid > ? ORDER BY rowid LIMIT ?",
        )
        .all(roomId, after, limit);
    },
  };
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export type RoomStore = ReturnType<typeof createRoomStore>;
