import type { HTMLBundle } from "bun";
import type { TokenVerifier } from "./auth/token";
import type { WebAuth } from "./auth/web-auth";
import { createGroupsHandler, createPeersHandler, createSetGroupsHandler } from "./broker/discovery";
import { type HygieneOverrides, resolveHygiene } from "./broker/hygiene";
import { startKeepalive } from "./broker/keepalive";
import { createRegisterHandler } from "./broker/register";
import { Registry } from "./broker/registry";
import { createSendHandler } from "./broker/send";
import { createSetMetaHandler } from "./broker/set-meta";
import type { Group } from "./store/groups";

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
}

type RouteHandler = (req: Request) => Response | Promise<Response>;
type RouteValue = HTMLBundle | RouteHandler | Partial<Record<"GET" | "POST" | "DELETE", RouteHandler>>;

export function startServer(config: ServerConfig) {
  const hygiene = resolveHygiene(config.hygiene);
  const registry = new Registry(hygiene.maxConnections);
  const register = createRegisterHandler({ registry, verifier: config.verifier });
  const send = createSendHandler({ registry });
  const setMeta = createSetMetaHandler({ registry });
  startKeepalive(registry, hygiene.keepaliveIntervalMs);

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

  const server = Bun.serve({
    port: config.port,
    // Bun.serve 기본 유휴 타임아웃은 10초 — keepalive 주기(30초)보다 짧아 SSE를 서버가 먼저 끊는다(02 §3).
    // 연결 생존 관리는 자체 위생(keepalive push 실패·cancel)이 담당하므로 비활성.
    idleTimeout: 0,
    routes,
    fetch() {
      return new Response("Not Found", { status: 404 });
    },
  });

  return { server, registry };
}
