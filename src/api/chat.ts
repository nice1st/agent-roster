import type { WebAuth } from "../auth/web-auth";
import { openAgentStream } from "../broker/register";
import type { Registry } from "../broker/registry";

export interface ChatApiDeps {
  webAuth: WebAuth;
  registry: Registry;
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

type RouteHandler = (req: Request) => Response | Promise<Response>;

export function createChatApiRoutes(deps: ChatApiDeps): Record<string, { GET?: RouteHandler }> {
  const { webAuth, registry } = deps;

  return {
    "/api/chat/stream": {
      // EventSource는 GET+쿠키만 지원한다 — 이 스트림이 GET인 이유.
      GET: async (req) => {
        const user = await webAuth.getSessionUser(req.headers);
        if (user === null) return jsonError(401, "session required");

        const url = new URL(req.url);
        const requestedUuid = url.searchParams.get("uuid") ?? undefined;

        return openAgentStream({
          registry,
          owner: user.id,
          requestedUuid,
          meta: { machine: "web", alias: user.email },
          exposure: [],
        });
      },
    },
  };
}
