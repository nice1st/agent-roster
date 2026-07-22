import type { TokenVerifier } from "../auth/token";
import type { BrokerEvent } from "../shared/protocol";
import type { AgentMeta, ConnectionHandle, Registry } from "./registry";
import { sseFrame } from "./sse";

interface RegisterBody {
  uuid?: string;
  meta?: AgentMeta;
}

export interface RegisterDeps {
  registry: Registry;
  verifier: TokenVerifier;
}

const encoder = new TextEncoder();

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

    const uuid = body.uuid ?? crypto.randomUUID();
    let handle: ConnectionHandle | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const h: ConnectionHandle = {
          send: (chunk) => controller.enqueue(encoder.encode(chunk)),
          close: () => {
            try {
              controller.close();
            } catch {
              // 이미 닫힌 스트림 — 무시
            }
          },
        };
        handle = h;
        // 소유자 검증은 위에서 했지만, 검증과 start 사이의 경합 대비로 register가 한 번 더 강제한다
        const result = deps.registry.register({
          uuid,
          owner: auth.userId,
          exposure: "follow",
          meta: body.meta ?? {},
          handle: h,
        });
        if (!result.ok) {
          h.send(sseFrame({ type: "error", error: "uuid owned by another user" } satisfies BrokerEvent));
          h.close();
          return;
        }
        h.send(sseFrame({ type: "registered", uuid } satisfies BrokerEvent));
      },
      cancel: () => {
        if (handle !== null) deps.registry.removeIfCurrent(uuid, handle);
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  };
}
