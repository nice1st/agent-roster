// 관리자 API — prefix /api/admin/*(05 §2 #7). 모든 엔드포인트는 세션의 user가 admin role일 때만 통과, 아니면 403.
// 라우트 맵을 export해 server.ts는 조립만 한다(병렬 슬라이스 충돌 최소화 규칙).

import type { Database } from "bun:sqlite";
import type { WebAuth } from "../auth/web-auth";
import { createGroupStore } from "../store/groups";

export interface AdminApiDeps {
  webAuth: WebAuth;
  db: Database;
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

type RouteHandler = (req: Request) => Response | Promise<Response>;

/** admin role 세션 가드 — 통과하면 핸들러에 인증된 user를 넘긴다. */
function requireAdmin(webAuth: WebAuth, handler: (req: Request, adminId: string) => Promise<Response>): RouteHandler {
  return async (req) => {
    const user = await webAuth.getSessionUser(req.headers);
    if (user === null || user.role !== "admin") return jsonError(403, "admin only");
    return handler(req, user.id);
  };
}

/** 관리자 API 라우트 맵 — server.ts는 이걸 routes에 펼쳐 넣기만 한다. */
export function createAdminApiRoutes(
  deps: AdminApiDeps,
): Record<string, { GET?: RouteHandler; POST?: RouteHandler; DELETE?: RouteHandler }> {
  const { webAuth, db } = deps;
  const groups = createGroupStore(db);

  return {
    "/api/admin/users": {
      GET: requireAdmin(webAuth, async () => {
        const users = await webAuth.listUsers();
        const withGroups = users.map((user) => ({ ...user, groupIds: groups.listGroupIdsForUser(user.id) }));
        return Response.json({ users: withGroups });
      }),
      POST: requireAdmin(webAuth, async (req) => {
        const body = await parseJsonBody(req);
        if (body === null || !isNonEmptyString(body.email)) return jsonError(400, "email required");
        const user = await webAuth.createUser(body.email);
        return Response.json({ user }, { status: 201 });
      }),
    },

    "/api/admin/users/:id": {
      DELETE: requireAdmin(webAuth, async (req, adminId) => {
        const id = new URL(req.url).pathname.split("/").pop() as string;
        if (id === adminId) return jsonError(400, "cannot delete yourself");
        const deleted = await webAuth.deleteUser(id);
        if (!deleted) return jsonError(404, "user not found");
        groups.removeAllForUser(id);
        return Response.json({ ok: true });
      }),
    },

    "/api/admin/groups": {
      GET: requireAdmin(webAuth, async () => Response.json({ groups: groups.list() })),
      POST: requireAdmin(webAuth, async (req) => {
        const body = await parseJsonBody(req);
        if (body === null || !isNonEmptyString(body.name)) return jsonError(400, "name required");
        const group = groups.create(body.name);
        return Response.json({ group }, { status: 201 });
      }),
    },

    "/api/admin/groups/:id": {
      DELETE: requireAdmin(webAuth, async (req) => {
        const id = new URL(req.url).pathname.split("/").pop() as string;
        const deleted = groups.remove(id);
        if (!deleted) return jsonError(404, "group not found");
        return Response.json({ ok: true });
      }),
    },

    "/api/admin/user-groups": {
      POST: requireAdmin(webAuth, async (req) => {
        const body = await parseJsonBody(req);
        if (body === null || !isNonEmptyString(body.userId) || !isNonEmptyString(body.groupId)) {
          return jsonError(400, "userId, groupId required");
        }
        groups.grant(body.userId, body.groupId);
        return Response.json({ ok: true });
      }),
      DELETE: requireAdmin(webAuth, async (req) => {
        const body = await parseJsonBody(req);
        if (body === null || !isNonEmptyString(body.userId) || !isNonEmptyString(body.groupId)) {
          return jsonError(400, "userId, groupId required");
        }
        groups.revoke(body.userId, body.groupId);
        return Response.json({ ok: true });
      }),
    },
  };
}
