// POST /room-send — room 발언(브로커, 무인증, from 자기신고, 05 §2 #13). 1:1 send와 별도 인터페이스인 이유는
// room 발언이 기록되고 전원에게 팬아웃되기 때문(01 §5·04 §2 send_room 행). store 직접 import 금지 — deps로 주입.

import type { Registry } from "./registry";
import { fanoutRoomMessage, fanoutTargets, type RoomSubscriptions } from "./rooms";

interface RoomSendBody {
  from?: unknown;
  room?: unknown;
  message?: unknown;
}

export interface RoomInfo {
  status: "draft" | "active" | "ended";
}

export interface RoomSendDeps {
  registry: Registry;
  subscriptions: RoomSubscriptions;
  getRoom(roomId: string): RoomInfo | null;
  isParticipant(roomId: string, uuid: string): boolean;
  listParticipantUuids(roomId: string): string[];
  /** 발신 시점 레지스트리 alias를 from_label로 기록·팬아웃한다(웹이면 email alias 그대로). */
  recordMessage(roomId: string, fromUuid: string, fromLabel: string | undefined, content: string): void;
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

async function parseBody(req: Request): Promise<RoomSendBody | null> {
  try {
    const parsed: unknown = await req.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as RoomSendBody) : null;
  } catch {
    return null;
  }
}

export function createRoomSendHandler(deps: RoomSendDeps) {
  return async (req: Request): Promise<Response> => {
    const body = await parseBody(req);
    if (body === null) return jsonError(400, "malformed body");
    const { from, room, message } = body;
    if (typeof from !== "string") return jsonError(400, "from must be a string");
    if (typeof room !== "string") return jsonError(400, "room must be a string");
    if (typeof message !== "string") return jsonError(400, "message must be a string");

    const roomInfo = deps.getRoom(room);
    if (roomInfo === null || roomInfo.status !== "active") {
      return Response.json({ ok: false, error: "Room not active" });
    }

    const subscribed = deps.subscriptions.get(room).has(from);
    if (!deps.isParticipant(room, from) && !subscribed) {
      return Response.json({ ok: false, error: "Not a participant" });
    }

    const fromLabel = deps.registry.get(from)?.meta.alias;
    deps.recordMessage(room, from, fromLabel, message);

    const targets = fanoutTargets(deps.listParticipantUuids(room), deps.subscriptions.get(room));
    fanoutRoomMessage(
      { registry: deps.registry },
      room,
      { from, fromLabel, content: message },
      targets,
      deps.subscriptions,
    );

    return Response.json({ ok: true });
  };
}
