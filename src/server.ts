import type { HTMLBundle } from "bun";
import { createAgentsApiRoutes } from "./api/agents";
import { createChatApiRoutes } from "./api/chat";
import { createRoomsApiRoutes } from "./api/rooms";
import type { TokenVerifier } from "./auth/token";
import type { WebAuth } from "./auth/web-auth";
import { createGroupsHandler, createPeersHandler, createSetGroupsHandler } from "./broker/discovery";
import { startHeartbeat } from "./broker/heartbeat";
import { type HygieneOverrides, resolveHygiene } from "./broker/hygiene";
import { sweepKeepalive } from "./broker/keepalive";
import { createRegisterHandler } from "./broker/register";
import { Registry } from "./broker/registry";
import { createRoomSendHandler } from "./broker/room-send";
import { RoomSubscriptions, sweepExpiredRooms } from "./broker/rooms";
import { createSendHandler } from "./broker/send";
import { createSetMetaHandler } from "./broker/set-meta";
import type { Group } from "./store/groups";
import type { RoomStore } from "./store/rooms";

export interface ServerConfig {
  port: number;
  verifier: TokenVerifier;
  hygiene?: HygieneOverrides;
  webAuth?: WebAuth;
  webRoutes?: Record<string, HTMLBundle>;
  adminRoutes?: Record<string, Partial<Record<"GET" | "POST" | "DELETE", RouteHandler>>>;
  groupsDeps?: { getUserGroups(userId: string): Group[] };
  agentsDeps?: { webAuth: WebAuth; getUserGroups(userId: string): Group[] };
  chatDeps?: { webAuth: WebAuth };
  roomsDeps?: { webAuth: WebAuth; rooms: RoomStore; getUserGroups(userId: string): Group[] };
}

type RouteHandler = (req: Request) => Response | Promise<Response>;
type RouteValue = HTMLBundle | RouteHandler | Partial<Record<"GET" | "POST" | "DELETE", RouteHandler>>;

export function startServer(config: ServerConfig) {
  const hygiene = resolveHygiene(config.hygiene);
  const registry = new Registry(hygiene.maxConnections);
  const register = createRegisterHandler({ registry, verifier: config.verifier });
  const send = createSendHandler({ registry });
  const setMeta = createSetMetaHandler({ registry });
  const heartbeatTasks: Array<() => void> = [() => sweepKeepalive(registry)];

  const routes: Record<string, RouteValue> = {
    "/health": () => Response.json({ ok: true }),
    "/register": { POST: register },
    "/send": { POST: send },
    "/set-meta": { POST: setMeta },
    ...config.webRoutes,
    ...config.adminRoutes,
  };
  const webAuth = config.webAuth;
  if (webAuth !== undefined) {
    routes["/api/auth/*"] = (req) => webAuth.handler(req);
  }
  const groupsDeps = config.groupsDeps;
  if (groupsDeps !== undefined) {
    const discoveryDeps = { registry, getUserGroups: groupsDeps.getUserGroups };
    routes["/peers"] = { POST: createPeersHandler(discoveryDeps) };
    routes["/set-groups"] = { POST: createSetGroupsHandler(discoveryDeps) };
    routes["/groups"] = { POST: createGroupsHandler(discoveryDeps) };
  }
  const agentsDeps = config.agentsDeps;
  if (agentsDeps !== undefined) {
    Object.assign(
      routes,
      createAgentsApiRoutes({ webAuth: agentsDeps.webAuth, registry, getUserGroups: agentsDeps.getUserGroups }),
    );
  }
  const chatDeps = config.chatDeps;
  if (chatDeps !== undefined) {
    Object.assign(routes, createChatApiRoutes({ webAuth: chatDeps.webAuth, registry }));
  }
  const roomsDeps = config.roomsDeps;
  if (roomsDeps !== undefined) {
    const subscriptions = new RoomSubscriptions();
    Object.assign(
      routes,
      createRoomsApiRoutes({
        webAuth: roomsDeps.webAuth,
        registry,
        rooms: roomsDeps.rooms,
        subscriptions,
        getUserGroups: roomsDeps.getUserGroups,
      }),
    );
    routes["/room-send"] = {
      POST: createRoomSendHandler({
        registry,
        subscriptions,
        getRoom: (roomId) => {
          const room = roomsDeps.rooms.get(roomId);
          return room === null ? null : { status: room.status, ends_at: room.ends_at };
        },
        isParticipant: (roomId, uuid) => roomsDeps.rooms.isParticipant(roomId, uuid),
        listParticipantUuids: (roomId) => roomsDeps.rooms.listParticipants(roomId).map((p) => p.agent_uuid),
        recordMessage: (roomId, fromUuid, fromLabel, content) =>
          roomsDeps.rooms.addMessage(roomId, fromUuid, fromLabel, content),
      }),
    };
    heartbeatTasks.push(() =>
      sweepExpiredRooms({
        registry,
        subscriptions,
        markEnded: (id) => roomsDeps.rooms.end(id),
        listParticipantUuids: (id) => roomsDeps.rooms.listParticipants(id).map((p) => p.agent_uuid),
        listExpiredRooms: (nowIso) => roomsDeps.rooms.listExpired(nowIso),
      }),
    );
  }

  startHeartbeat(hygiene.heartbeatIntervalMs, heartbeatTasks);

  const server = Bun.serve({
    port: config.port,
    // Bun.serve 기본 유휴 타임아웃 10초가 keepalive 주기(기본 30초)보다 짧아 SSE를 서버가 먼저 끊는다 — 생존 관리는 keepalive가 담당하므로 비활성.
    idleTimeout: 0,
    routes,
    fetch() {
      return new Response("Not Found", { status: 404 });
    },
  });

  return { server, registry };
}
