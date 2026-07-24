// 웹 1:1 대화 스트림 — GET /api/chat/stream?uuid=...(05 §2 #11). 세션 인증(없으면 401), register 코어를
// exposure []( 노출 0 — 01 §3.2 웹 세션은 노출 없는 엔트리)로 호출한다. owner = 세션 user id.
// uuid 쿼리로 리쥼(소유 검증은 코어가 함). EventSource는 GET+쿠키만 지원하므로 GET.
// 발신은 기존 POST /send 그대로(웹이 fetch로, from = 웹 uuid) — 이 파일에 발신 엔드포인트를 두지 않는다.

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

/** 채팅 스트림 API 라우트 맵 — server.ts는 이걸 routes에 펼쳐 넣기만 한다(agents.ts와 동일 조립 패턴). */
export function createChatApiRoutes(deps: ChatApiDeps): Record<string, { GET?: RouteHandler }> {
  const { webAuth, registry } = deps;

  return {
    "/api/chat/stream": {
      GET: async (req) => {
        const user = await webAuth.getSessionUser(req.headers);
        if (user === null) return jsonError(401, "session required");

        const url = new URL(req.url);
        const requestedUuid = url.searchParams.get("uuid") ?? undefined;

        // 웹 세션임이 표시에 드러나도록 machine "web", alias는 email(01 §3.2·05 §2 #11 이음새).
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
