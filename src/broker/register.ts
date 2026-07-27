import type { TokenVerifier } from "../auth/token";
import type { BrokerEvent } from "../shared/protocol";
import type { AgentMeta, Exposure, Registry } from "./registry";
import { createSseConnection, sseFrame } from "./sse";

interface RegisterBody {
  uuid?: string;
  meta?: AgentMeta;
}

export interface RegisterDeps {
  registry: Registry;
  verifier: TokenVerifier;
}

export interface OpenAgentStreamArgs {
  registry: Registry;
  owner: string;
  requestedUuid?: string;
  meta: AgentMeta;
  exposure: Exposure;
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header === null || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

async function parseBody(req: Request): Promise<RegisterBody | null> {
  const text = await req.text();
  if (text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as RegisterBody) : null;
  } catch {
    return null;
  }
}

export function openAgentStream(args: OpenAgentStreamArgs): Response {
  const { registry, owner, requestedUuid, meta, exposure } = args;

  const existing = requestedUuid !== undefined ? registry.get(requestedUuid) : undefined;
  if (existing !== undefined && existing.owner !== owner) {
    return jsonError(403, "uuid owned by another user");
  }
  if (existing === undefined && registry.isFull) return jsonError(503, "broker full");

  const uuid = requestedUuid ?? crypto.randomUUID();
  const { stream, handle } = createSseConnection({
    onCancel: (h) => registry.removeIfCurrent(uuid, h),
  });
  const result = registry.register({ uuid, owner, exposure, meta, handle });
  if (result.ok) {
    handle.send(sseFrame({ type: "registered", uuid } satisfies BrokerEvent));
  } else {
    const error = result.reason === "broker-full" ? "broker full" : "uuid owned by another user";
    handle.send(sseFrame({ type: "error", error } satisfies BrokerEvent));
    handle.close();
  }

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

export function createRegisterHandler(deps: RegisterDeps) {
  return async (req: Request): Promise<Response> => {
    const token = bearerToken(req);
    if (token === null) return jsonError(401, "missing bearer token");
    const auth = await deps.verifier.verify(token);
    if (auth === null) return jsonError(401, "invalid token");

    const body = await parseBody(req);
    if (body === null) return jsonError(400, "malformed body");

    return openAgentStream({
      registry: deps.registry,
      owner: auth.userId,
      requestedUuid: body.uuid,
      meta: body.meta ?? {},
      exposure: "follow",
    });
  };
}
