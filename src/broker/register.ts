import type { TokenVerifier } from "../auth/token";
import type { BrokerEvent } from "../shared/protocol";
import type { AgentMeta, Registry } from "./registry";
import { createSseConnection, sseFrame } from "./sse";

interface RegisterBody {
  uuid?: string;
  meta?: AgentMeta;
}

export interface RegisterDeps {
  registry: Registry;
  verifier: TokenVerifier;
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

export function createRegisterHandler(deps: RegisterDeps) {
  return async (req: Request): Promise<Response> => {
    const token = bearerToken(req);
    if (token === null) return jsonError(401, "missing bearer token");
    const auth = await deps.verifier.verify(token);
    if (auth === null) return jsonError(401, "invalid token");

    const body = await parseBody(req);
    if (body === null) return jsonError(400, "malformed body");

    const existing = body.uuid !== undefined ? deps.registry.get(body.uuid) : undefined;
    if (existing !== undefined && existing.owner !== auth.userId) {
      return jsonError(403, "uuid owned by another user");
    }
    // 리쥼(교체)은 총량 불변이라 상한과 무관 — 산 엔트리가 없는 등록만 정원을 본다
    if (existing === undefined && deps.registry.isFull) return jsonError(503, "broker full");

    const uuid = body.uuid ?? crypto.randomUUID();
    const { stream, handle } = createSseConnection({
      onCancel: (h) => deps.registry.removeIfCurrent(uuid, h),
    });
    // 사전 검사와 이 지점 사이(await 경계)의 경합 대비로 register가 소유·정원을 한 번 더 강제한다
    const result = deps.registry.register({
      uuid,
      owner: auth.userId,
      exposure: "follow",
      meta: body.meta ?? {},
      handle,
    });
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
  };
}
