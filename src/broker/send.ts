import type { MessageEvent } from "../shared/protocol";
import type { Registry } from "./registry";
import { sseFrame } from "./sse";

interface SendBody {
  from?: unknown;
  to?: unknown;
  message?: unknown;
  skill?: unknown;
}

export interface SendDeps {
  registry: Registry;
}

const PEER_NOT_FOUND = { ok: false, error: "Peer not found" } as const;

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

async function parseBody(req: Request): Promise<SendBody | null> {
  try {
    const parsed: unknown = await req.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as SendBody) : null;
  } catch {
    return null;
  }
}

export function createSendHandler(deps: SendDeps) {
  return async (req: Request): Promise<Response> => {
    const body = await parseBody(req);
    if (body === null) return jsonError(400, "malformed body");
    const { from, to, message, skill } = body;
    if (typeof from !== "string") return jsonError(400, "from must be a string");
    if (typeof to !== "string") return jsonError(400, "to must be a string");
    if (typeof message !== "string") return jsonError(400, "message must be a string");

    const entry = deps.registry.get(to);
    if (entry === undefined) return Response.json(PEER_NOT_FOUND);

    const event: MessageEvent = { type: "message", from, sent_at: new Date().toISOString(), message };
    if (typeof skill === "string") event.skill = skill;

    try {
      entry.handle.send(sseFrame(event));
    } catch {
      deps.registry.removeIfCurrent(to, entry.handle);
      return Response.json(PEER_NOT_FOUND);
    }
    return Response.json({ ok: true });
  };
}
