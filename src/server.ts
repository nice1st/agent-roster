import type { HTMLBundle } from "bun";
import type { TokenVerifier } from "./auth/token";
import type { WebAuth } from "./auth/web-auth";
import { type HygieneOverrides, resolveHygiene } from "./broker/hygiene";
import { startKeepalive } from "./broker/keepalive";
import { createRegisterHandler } from "./broker/register";
import { Registry } from "./broker/registry";
import { createSendHandler } from "./broker/send";

export interface ServerConfig {
  port: number;
  verifier: TokenVerifier;
  hygiene?: HygieneOverrides;
  /** 없으면 /api/auth를 마운트하지 않는다 — 브로커는 인증 없이도 돈다. */
  webAuth?: WebAuth;
  /** 웹 UI 라우트(HTML import) — 예: { "/": index }. */
  webRoutes?: Record<string, HTMLBundle>;
}

type RouteHandler = (req: Request) => Response | Promise<Response>;
type RouteValue = HTMLBundle | RouteHandler | { POST: RouteHandler };

export function startServer(config: ServerConfig) {
  const hygiene = resolveHygiene(config.hygiene);
  const registry = new Registry(hygiene.maxConnections);
  const register = createRegisterHandler({ registry, verifier: config.verifier });
  const send = createSendHandler({ registry });
  startKeepalive(registry, hygiene.keepaliveIntervalMs);

  const routes: Record<string, RouteValue> = {
    "/health": () => Response.json({ ok: true }),
    "/register": { POST: register },
    "/send": { POST: send },
    ...config.webRoutes,
  };
  const webAuth = config.webAuth;
  if (webAuth !== undefined) {
    routes["/api/auth/*"] = (req) => webAuth.handler(req);
  }

  const server = Bun.serve({
    port: config.port,
    routes,
    fetch() {
      return new Response("Not Found", { status: 404 });
    },
  });

  return { server, registry };
}
