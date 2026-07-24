// room·room_participant·message 저장소 접근 — SQL은 이 모듈 안에만 둔다(05 §4). 스키마는 db/migrations/002-rooms.sql.
// duration_minutes는 draft 동안 보관해두는 분 값이고, ends_at은 시작(및 PATCH) 시점에 "지금부터 N분"으로 확정한다.

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
}

export interface RoomParticipant {
  room_id: string;
  agent_uuid: string;
  alias_snapshot: string | null;
  persona: string | null;
  output_instruction: string | null;
}

export interface Message {
  room_id: string;
  from_uuid: string;
  from_label: string | null;
  content: string;
  sent_at: string;
}

export function createRoomStore(db: Database) {
  return {
    create(createdBy: string, name: string, context: string | undefined, durationMinutes: number): Room {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(
        "INSERT INTO rooms (id, name, context, status, duration_minutes, ends_at, created_by, created_at) VALUES (?, ?, ?, 'draft', ?, NULL, ?, ?)",
      ).run(id, name, context ?? null, durationMinutes, createdBy, createdAt);
      return {
        id,
        name,
        context: context ?? null,
        status: "draft",
        duration_minutes: durationMinutes,
        ends_at: null,
        created_by: createdBy,
        created_at: createdAt,
      };
    },

    get(roomId: string): Room | null {
      return db.query<Room, [string]>("SELECT * FROM rooms WHERE id = ?").get(roomId);
    },

    listForUser(userId: string): Room[] {
      return db.query<Room, [string]>("SELECT * FROM rooms WHERE created_by = ? ORDER BY created_at DESC").all(userId);
    },

    /** draft→active 전환, ends_at 확정(무제한이면 null 유지). */
    start(roomId: string): void {
      const room = this.get(roomId);
      if (room === null) return;
      const endsAt = room.duration_minutes > 0 ? minutesFromNow(room.duration_minutes) : null;
      db.prepare("UPDATE rooms SET status = 'active', ends_at = ? WHERE id = ?").run(endsAt, roomId);
    },

    /** 지금부터 N분으로 ends_at 재설정(0 = 무제한 해제). active 중 포함, 언제나 가능(호출자가 ended 여부를 가드). */
    setDuration(roomId: string, durationMinutes: number): void {
      const endsAt = durationMinutes > 0 ? minutesFromNow(durationMinutes) : null;
      db.prepare("UPDATE rooms SET duration_minutes = ?, ends_at = ? WHERE id = ?").run(
        durationMinutes,
        endsAt,
        roomId,
      );
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
      db.prepare("INSERT INTO messages (room_id, from_uuid, from_label, content, sent_at) VALUES (?, ?, ?, ?, ?)").run(
        roomId,
        fromUuid,
        fromLabel ?? null,
        content,
        sentAt,
      );
      return { room_id: roomId, from_uuid: fromUuid, from_label: fromLabel ?? null, content, sent_at: sentAt };
    },

    listMessages(roomId: string): Message[] {
      return db
        .query<Message, [string]>(
          "SELECT room_id, from_uuid, from_label, content, sent_at FROM messages WHERE room_id = ? ORDER BY rowid",
        )
        .all(roomId);
    },
  };
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export type RoomStore = ReturnType<typeof createRoomStore>;
