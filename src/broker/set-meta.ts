import type { Registry } from "./registry";

interface SetMetaBody {
  from?: unknown;
  alias?: unknown;
  status?: unknown;
}

export interface SetMetaDeps {
  registry: Registry;
}

const PEER_NOT_FOUND = { ok: false, error: "Peer not found" } as const;

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

async function parseBody(req: Request): Promise<SetMetaBody | null> {
  try {
    const parsed: unknown = await req.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as SetMetaBody) : null;
  } catch {
    return null;
  }
}

export function createSetMetaHandler(deps: SetMetaDeps) {
  return async (req: Request): Promise<Response> => {
    const body = await parseBody(req);
    if (body === null || typeof body.from !== "string") return jsonError(400, "from must be a string");
    if (body.alias !== undefined && typeof body.alias !== "string") return jsonError(400, "alias must be a string");
    if (body.status !== undefined && typeof body.status !== "string") return jsonError(400, "status must be a string");

    const entry = deps.registry.get(body.from);
    if (entry === undefined) return Response.json(PEER_NOT_FOUND);

    const patch: { alias?: string; status?: string } = {};
    if (body.alias !== undefined) patch.alias = body.alias;
    if (body.status !== undefined) patch.status = body.status;
    deps.registry.mergeMeta(body.from, patch);
    return Response.json({ ok: true });
  };
}
