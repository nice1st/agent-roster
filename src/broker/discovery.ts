import type { Group } from "../store/groups";
import type { Exposure, Registry, RegistryEntry } from "./registry";

export interface DiscoveryDeps {
  registry: Registry;
  getUserGroups(userId: string): Group[];
}

const PEER_NOT_FOUND = { ok: false, error: "Peer not found" } as const;

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

async function parseBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function effectiveExposure(exposure: Exposure, currentGroupIds: string[]): Set<string> {
  if (exposure === "follow") return new Set(currentGroupIds);
  const current = new Set(currentGroupIds);
  return new Set(exposure.filter((id) => current.has(id)));
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const id of a) {
    if (b.has(id)) return true;
  }
  return false;
}

function isVisible(deps: DiscoveryDeps, viewer: RegistryEntry, target: RegistryEntry): boolean {
  const viewerExposed = effectiveExposure(
    viewer.exposure,
    deps.getUserGroups(viewer.owner).map((g) => g.id),
  );
  const targetExposed = effectiveExposure(
    target.exposure,
    deps.getUserGroups(target.owner).map((g) => g.id),
  );
  return intersects(viewerExposed, targetExposed);
}

export function createPeersHandler(deps: DiscoveryDeps) {
  return async (req: Request): Promise<Response> => {
    const body = await parseBody(req);
    if (body === null || typeof body.from !== "string") return jsonError(400, "from must be a string");

    const viewer = deps.registry.get(body.from);
    if (viewer === undefined) return Response.json(PEER_NOT_FOUND);

    const peers = [...deps.registry.values()]
      .filter((target) => isVisible(deps, viewer, target))
      .map((target) => ({ uuid: target.uuid, meta: target.meta }));
    return Response.json({ ok: true, peers });
  };
}

export function createSetGroupsHandler(deps: DiscoveryDeps) {
  return async (req: Request): Promise<Response> => {
    const body = await parseBody(req);
    if (body === null || typeof body.from !== "string") return jsonError(400, "from must be a string");
    if (!Array.isArray(body.groups) || !body.groups.every((g) => typeof g === "string")) {
      return jsonError(400, "groups must be a string array");
    }

    const entry = deps.registry.get(body.from);
    if (entry === undefined) return Response.json(PEER_NOT_FOUND);

    deps.registry.setExposure(body.from, body.groups as string[]);
    return Response.json({ ok: true });
  };
}

export function createGroupsHandler(deps: DiscoveryDeps) {
  return async (req: Request): Promise<Response> => {
    const body = await parseBody(req);
    if (body === null || typeof body.from !== "string") return jsonError(400, "from must be a string");

    const entry = deps.registry.get(body.from);
    if (entry === undefined) return Response.json(PEER_NOT_FOUND);

    const memberOf = deps.getUserGroups(entry.owner);
    const exposed = [
      ...effectiveExposure(
        entry.exposure,
        memberOf.map((g) => g.id),
      ),
    ];
    return Response.json({ ok: true, member_of: memberOf, exposure: entry.exposure, exposed });
  };
}
