// 웹 room API — prefix /api/rooms(05 §2 #12·#13·#14·#15). 전부 세션 필요(없으면 401). room 조작(participants·start·
// PATCH·end)과 기록 조회(messages)는 created_by 본인만, 아니면 403. 참여자 배치 대상은 세션 user에게 보이는
// 에이전트만(agents.ts의 isVisibleToViewer 재사용). ended room도 기록 조회는 가능하다(01 §5 기록 보존).

import type { WebAuth } from "../auth/web-auth";
import type { Registry } from "../broker/registry";
import { endRoom as brokerEndRoom, fanoutRoomStart, type RoomSubscriptions } from "../broker/rooms";
import type { Group } from "../store/groups";
import type { RoomStore } from "../store/rooms";
import { isVisibleToViewer } from "./agents";

export interface RoomsApiDeps {
  webAuth: WebAuth;
  registry: Registry;
  rooms: RoomStore;
  subscriptions: RoomSubscriptions;
  getUserGroups(userId: string): Group[];
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

// limit 상한 — 명시 안 하면 기본으로도 쓴다(과도한 단일 응답 방지).
const MAX_MESSAGES_LIMIT = 200;

type RouteHandler = (req: Request) => Response | Promise<Response>;

async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** 세션 가드 — 통과하면 핸들러에 인증된 userId를 넘긴다(admin.ts·agents.ts와 동일 패턴). */
function requireSession(webAuth: WebAuth, handler: (req: Request, userId: string) => Promise<Response>): RouteHandler {
  return async (req) => {
    const user = await webAuth.getSessionUser(req.headers);
    if (user === null) return jsonError(401, "session required");
    return handler(req, user.id);
  };
}

function roomIdFromPath(req: Request, segmentsFromEnd: number): string {
  const parts = new URL(req.url).pathname.split("/");
  return parts[parts.length - segmentsFromEnd] as string;
}

/** room API 라우트 맵 — server.ts는 이걸 routes에 펼쳐 넣기만 한다(admin.ts·agents.ts와 동일 조립 패턴). */
export function createRoomsApiRoutes(
  deps: RoomsApiDeps,
): Record<string, Partial<Record<"GET" | "POST" | "DELETE" | "PATCH", RouteHandler>>> {
  const { webAuth, registry, rooms, subscriptions, getUserGroups } = deps;

  /** created_by 본인 검증 — room이 없으면 404, 본인이 아니면 403. 통과하면 room을 돌려준다. */
  async function requireOwnedRoom(
    userId: string,
    roomId: string,
    handler: (room: NonNullable<ReturnType<RoomStore["get"]>>) => Promise<Response>,
  ): Promise<Response> {
    const room = rooms.get(roomId);
    if (room === null) return jsonError(404, "room not found");
    if (room.created_by !== userId) return jsonError(403, "room owned by another user");
    return handler(room);
  }

  return {
    "/api/rooms": {
      POST: requireSession(webAuth, async (req, userId) => {
        const body = await parseJsonBody(req);
        if (body === null || !isNonEmptyString(body.name)) return jsonError(400, "name required");
        const context = typeof body.context === "string" ? body.context : undefined;
        const durationMinutes =
          typeof body.duration_minutes === "number" && body.duration_minutes > 0
            ? Math.floor(body.duration_minutes)
            : 0;
        const room = rooms.create(userId, body.name, context, durationMinutes);
        return Response.json({ room }, { status: 201 });
      }),
      GET: requireSession(webAuth, async (_req, userId) => {
        return Response.json({ rooms: rooms.listForUser(userId) });
      }),
    },

    "/api/rooms/:id": {
      PATCH: requireSession(webAuth, async (req, userId) => {
        const roomId = roomIdFromPath(req, 1);
        return requireOwnedRoom(userId, roomId, async (room) => {
          if (room.status === "ended") return jsonError(400, "room ended");
          const body = await parseJsonBody(req);
          if (body === null || typeof body.duration_minutes !== "number") {
            return jsonError(400, "duration_minutes required");
          }
          const durationMinutes = Math.max(0, Math.floor(body.duration_minutes));
          rooms.setDuration(roomId, durationMinutes);
          return Response.json({ room: rooms.get(roomId) });
        });
      }),
    },

    "/api/rooms/:id/participants": {
      POST: requireSession(webAuth, async (req, userId) => {
        const roomId = roomIdFromPath(req, 2);
        return requireOwnedRoom(userId, roomId, async (room) => {
          if (room.status !== "draft") return jsonError(400, "room not in draft");
          const body = await parseJsonBody(req);
          if (body === null || !isNonEmptyString(body.agent_uuid)) return jsonError(400, "agent_uuid required");

          const entry = registry.get(body.agent_uuid);
          if (entry === undefined) return jsonError(404, "agent not found");
          const viewerGroupIds = getUserGroups(userId).map((g) => g.id);
          if (!isVisibleToViewer(entry, viewerGroupIds, getUserGroups)) {
            return jsonError(403, "agent not visible to you");
          }

          const persona = typeof body.persona === "string" ? body.persona : undefined;
          const outputInstruction = typeof body.output_instruction === "string" ? body.output_instruction : undefined;
          rooms.addParticipant(roomId, body.agent_uuid, entry.meta.alias, persona, outputInstruction);
          return Response.json({ ok: true }, { status: 201 });
        });
      }),
    },

    "/api/rooms/:id/participants/:uuid": {
      DELETE: requireSession(webAuth, async (req, userId) => {
        const roomId = roomIdFromPath(req, 3);
        const agentUuid = roomIdFromPath(req, 1);
        return requireOwnedRoom(userId, roomId, async (room) => {
          if (room.status !== "draft") return jsonError(400, "room not in draft");
          const removed = rooms.removeParticipant(roomId, agentUuid);
          if (!removed) return jsonError(404, "participant not found");
          return Response.json({ ok: true });
        });
      }),
    },

    "/api/rooms/:id/start": {
      POST: requireSession(webAuth, async (req, userId) => {
        const roomId = roomIdFromPath(req, 2);
        return requireOwnedRoom(userId, roomId, async (room) => {
          if (room.status !== "draft") return jsonError(400, "room not in draft");
          rooms.start(roomId);
          const participants = rooms.listParticipants(roomId);
          fanoutRoomStart(
            { registry },
            { id: room.id, name: room.name, ...(room.context !== null ? { context: room.context } : {}) },
            participants.map((p) => ({
              uuid: p.agent_uuid,
              alias: p.alias_snapshot ?? undefined,
              persona: p.persona ?? undefined,
            })),
          );
          return Response.json({ room: rooms.get(roomId) });
        });
      }),
    },

    "/api/rooms/:id/end": {
      POST: requireSession(webAuth, async (req, userId) => {
        const roomId = roomIdFromPath(req, 2);
        return requireOwnedRoom(userId, roomId, async (room) => {
          if (room.status === "ended") return jsonError(400, "room ended");
          brokerEndRoom(
            {
              registry,
              subscriptions,
              markEnded: (id) => rooms.end(id),
              listParticipantUuids: (id) => rooms.listParticipants(id).map((p) => p.agent_uuid),
            },
            { id: room.id, name: room.name },
          );
          return Response.json({ room: rooms.get(roomId) });
        });
      }),
    },

    "/api/rooms/:id/messages": {
      GET: requireSession(webAuth, async (req, userId) => {
        const roomId = roomIdFromPath(req, 2);
        return requireOwnedRoom(userId, roomId, async () => {
          const url = new URL(req.url);
          const afterParam = url.searchParams.get("after");
          const limitParam = url.searchParams.get("limit");
          const after = afterParam !== null && /^\d+$/.test(afterParam) ? Number(afterParam) : 0;
          const limit =
            limitParam !== null && /^\d+$/.test(limitParam)
              ? Math.min(Number(limitParam), MAX_MESSAGES_LIMIT)
              : MAX_MESSAGES_LIMIT;

          const rows = rooms.listMessagesAfter(roomId, after, limit);
          const messages = rows.map((m) => ({
            id: m.id,
            from: m.from_uuid,
            from_label: m.from_label ?? undefined,
            content: m.content,
            sent_at: m.sent_at,
          }));
          const participants = rooms.listParticipants(roomId).map((p) => ({
            agent_uuid: p.agent_uuid,
            alias_snapshot: p.alias_snapshot,
            persona: p.persona,
          }));
          return Response.json({
            messages,
            participants,
            next_after: messages.length > 0 ? messages[messages.length - 1]?.id : after,
            has_more: messages.length === limit,
          });
        });
      }),
    },

    "/api/rooms/:id/watch": {
      POST: requireSession(webAuth, async (req, userId) => {
        const roomId = roomIdFromPath(req, 2);
        const room = rooms.get(roomId);
        if (room === null) return jsonError(404, "room not found");
        const body = await parseJsonBody(req);
        if (body === null || !isNonEmptyString(body.uuid)) return jsonError(400, "uuid required");

        const entry = registry.get(body.uuid);
        if (entry === undefined || entry.owner !== userId) return jsonError(403, "not your entry");
        subscriptions.add(roomId, body.uuid);
        return Response.json({ ok: true });
      }),
      DELETE: requireSession(webAuth, async (req, userId) => {
        const roomId = roomIdFromPath(req, 2);
        const room = rooms.get(roomId);
        if (room === null) return jsonError(404, "room not found");
        const body = await parseJsonBody(req);
        if (body === null || !isNonEmptyString(body.uuid)) return jsonError(400, "uuid required");

        const entry = registry.get(body.uuid);
        if (entry === undefined || entry.owner !== userId) return jsonError(403, "not your entry");
        subscriptions.remove(roomId, body.uuid);
        return Response.json({ ok: true });
      }),
    },
  };
}
