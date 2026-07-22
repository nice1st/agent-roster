export interface ServerConfig {
  port: number;
}

export function startServer(config: ServerConfig) {
  return Bun.serve({
    port: config.port,
    routes: {
      "/health": () => Response.json({ ok: true }),
    },
    fetch() {
      return new Response("Not Found", { status: 404 });
    },
  });
}
