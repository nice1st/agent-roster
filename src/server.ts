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
  /** 없으면 /api/auth를 마운트하지 않는다 — 브로커는 인증 없이도 돈다. */
  webAuth?: WebAuth;
  /** 웹 UI 라우트(HTML import) — 예: { "/": index }. */
  webRoutes?: Record<string, HTMLBundle>;
  /** 관리자 API 라우트(src/api/admin.ts가 조합해 export) — 없으면 마운트하지 않는다. */
  adminRoutes?: Record<string, Partial<Record<"GET" | "POST" | "DELETE", RouteHandler>>>;
  /** 없으면 /peers·/set-groups·/groups를 마운트하지 않는다(05 §2 #8 — 그룹 조회 의존성은 선택). */
  groupsDeps?: { getUserGroups(userId: string): Group[] };
  /**
   * 없으면 /api/agents·/api/my-agents를 마운트하지 않는다(05 §2 #10). registry를 필요로 해서
   * groupsDeps처럼 deps만 받고 라우트는 startServer 내부에서 조립한다(admin.ts와 달리 registry는
   * startServer 안에서 생성되므로 미리 만든 라우트 맵을 주입할 수 없다).
   */
  agentsDeps?: { webAuth: WebAuth; getUserGroups(userId: string): Group[] };
  /** 없으면 /api/chat/stream을 마운트하지 않는다(05 §2 #11) — agentsDeps와 동일한 이유로 registry 의존. */
  chatDeps?: { webAuth: WebAuth };
  /** 없으면 /api/rooms*을 마운트하지 않는다(05 §2 #12) — agentsDeps와 동일한 이유로 registry 의존. */
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
  // 하트비트 작업 목록 — 앱 전체 인터벌은 이 하나뿐이다(05 §4). roomsDeps가 있으면 만료 스위프도 등록한다.
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
    // 만료 스위프 — 하트비트 작업으로 등록(05 §4). 버튼 폭파와 같은 endRoom을 탄다(broker/rooms.ts).
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
    // Bun.serve 기본 유휴 타임아웃은 10초 — 하트비트 주기(기본 30초, keepalive를 그 위에서 돌림)보다 짧아 SSE를 서버가 먼저 끊는다(02 §3).
    // 연결 생존 관리는 자체 위생(keepalive push 실패·cancel)이 담당하므로 비활성.
    idleTimeout: 0,
    routes,
    fetch() {
      return new Response("Not Found", { status: 404 });
    },
  });

  return { server, registry };
}
