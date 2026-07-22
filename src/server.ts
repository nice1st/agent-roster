import type { TokenVerifier } from "./auth/token";
import { createRegisterHandler } from "./broker/register";
import { Registry } from "./broker/registry";

export interface ServerConfig {
  port: number;
  verifier: TokenVerifier;
}

export function startServer(config: ServerConfig) {
  const registry = new Registry();
  const register = createRegisterHandler({ registry, verifier: config.verifier });

  const server = Bun.serve({
    port: config.port,
    routes: {
      "/health": () => Response.json({ ok: true }),
      "/register": { POST: register },
    },
    fetch() {
      return new Response("Not Found", { status: 404 });
    },
  });

  return { server, registry };
}
