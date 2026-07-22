import type { TokenVerifier } from "./auth/token";
import { type HygieneOverrides, resolveHygiene } from "./broker/hygiene";
import { startKeepalive } from "./broker/keepalive";
import { createRegisterHandler } from "./broker/register";
import { Registry } from "./broker/registry";
import { createSendHandler } from "./broker/send";

export interface ServerConfig {
  port: number;
  verifier: TokenVerifier;
  hygiene?: HygieneOverrides;
}

export function startServer(config: ServerConfig) {
  const hygiene = resolveHygiene(config.hygiene);
  const registry = new Registry(hygiene.maxConnections);
  const register = createRegisterHandler({ registry, verifier: config.verifier });
  const send = createSendHandler({ registry });
  startKeepalive(registry, hygiene.keepaliveIntervalMs);

  const server = Bun.serve({
    port: config.port,
    routes: {
      "/health": () => Response.json({ ok: true }),
      "/register": { POST: register },
      "/send": { POST: send },
    },
    fetch() {
      return new Response("Not Found", { status: 404 });
    },
  });

  return { server, registry };
}
