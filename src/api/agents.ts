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

function requireSession(webAuth: WebAuth, handler: (req: Request, userId: string) => Promise<Response>): RouteHandler {
  return async (req) => {
    const user = await webAuth.getSessionUser(req.headers);
    if (user === null) return jsonError(401, "session required");
    return handler(req, user.id);
  };
}

async function ownerEmailMap(webAuth: WebAuth): Promise<Map<string, string>> {
  const users = await webAuth.listUsers();
  return new Map(users.map((u) => [u.id, u.email]));
}

export function isVisibleToViewer(
  entry: RegistryEntry,
  viewerGroupIds: string[],
  getUserGroups: (userId: string) => Group[],
): boolean {
  const ownerGroupIds = getUserGroups(entry.owner).map((g) => g.id);
  const targetExposed = effectiveExposure(entry.exposure, ownerGroupIds);
  return viewerGroupIds.some((id) => targetExposed.has(id));
}

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
