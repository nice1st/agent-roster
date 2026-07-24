// 에이전트 목록 API — GET /api/agents·/api/my-agents(05 §2 #10). 둘 다 Better Auth 세션 필요(admin 불요, 없으면 401).
// /api/agents 판정: 세션 user의 현재 그룹 전체 ∩ 유효노출(대상) ≠ ∅ (01 §3.2 발견 판정과 동일 교집합, discovery.ts의 effectiveExposure 재사용).
// /api/my-agents는 노출과 무관 — owner == 세션 user.id인 엔트리 전부(03 "내 에이전트"는 소유 기준).

import type { WebAuth } from "../auth/web-auth";
import { effectiveExposure } from "../broker/discovery";
import type { Registry, RegistryEntry } from "../broker/registry";
import type { Group } from "../store/groups";

export interface AgentsApiDeps {
  webAuth: WebAuth;
  registry: Registry;
  getUserGroups(userId: string): Group[];
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

type RouteHandler = (req: Request) => Response | Promise<Response>;

/** 세션 가드 — 통과하면 핸들러에 인증된 user를 넘긴다(admin 불요). */
function requireSession(webAuth: WebAuth, handler: (req: Request, userId: string) => Promise<Response>): RouteHandler {
  return async (req) => {
    const user = await webAuth.getSessionUser(req.headers);
    if (user === null) return jsonError(401, "session required");
    return handler(req, user.id);
  };
}

/** email 해석용 — listUsers를 1회 불러 id → email 맵을 만든다(webAuth의 기존 표면 재사용, 재구현 금지). */
async function ownerEmailMap(webAuth: WebAuth): Promise<Map<string, string>> {
  const users = await webAuth.listUsers();
  return new Map(users.map((u) => [u.id, u.email]));
}

/** 세션 user의 현재 그룹 전체 ∩ 유효노출(대상) ≠ ∅ (discovery.ts의 isVisible과 동일 교집합 판정). */
function isVisibleToViewer(
  entry: RegistryEntry,
  viewerGroupIds: string[],
  getUserGroups: (userId: string) => Group[],
): boolean {
  const ownerGroupIds = getUserGroups(entry.owner).map((g) => g.id);
  const targetExposed = effectiveExposure(entry.exposure, ownerGroupIds);
  return viewerGroupIds.some((id) => targetExposed.has(id));
}

/** 에이전트 API 라우트 맵 — server.ts는 이걸 routes에 펼쳐 넣기만 한다(admin.ts와 동일 조립 패턴). */
export function createAgentsApiRoutes(deps: AgentsApiDeps): Record<string, { GET?: RouteHandler }> {
  const { webAuth, registry, getUserGroups } = deps;

  return {
    "/api/agents": {
      GET: requireSession(webAuth, async (_req, userId) => {
        const viewerGroupIds = getUserGroups(userId).map((g) => g.id);
        const visible = [...registry.values()].filter((entry) =>
          isVisibleToViewer(entry, viewerGroupIds, getUserGroups),
        );
        const emailOf = await ownerEmailMap(webAuth);
        const agents = visible.map((entry) => ({
          uuid: entry.uuid,
          meta: entry.meta,
          owner: { email: emailOf.get(entry.owner) ?? entry.owner },
        }));
        return Response.json({ agents });
      }),
    },

    "/api/my-agents": {
      GET: requireSession(webAuth, async (_req, userId) => {
        const mine = [...registry.values()].filter((entry) => entry.owner === userId);
        const agents = mine.map((entry) => ({ uuid: entry.uuid, meta: entry.meta }));
        return Response.json({ agents });
      }),
    },
  };
}
