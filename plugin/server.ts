// CC 플러그인 채널 서버(stdio MCP) — 슬라이스 2: register + send_message, 인바운드 message 알림.
import { hostname } from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { type BrokerConnection, registerWithBroker } from "./broker-client";
import { toChannelNotification } from "./channel";
import { ENV_BROKER_TOKEN, ENV_BROKER_URL } from "./env";

const mcp = new Server(
  { name: "agent-orchestra-channel", version: "0.0.1" },
  {
    capabilities: { experimental: { "claude/channel": {} }, tools: {} },
    instructions: `This session is an agent on the agent-orchestra broker: other agents can message you by UUID.

Inbound messages arrive as:
<channel from_id="SENDER_UUID" sent_at="..." [skill="SKILL_NAME"]>
MESSAGE CONTENT
</channel>

If the tag carries a skill attribute, you MUST run that skill through the Skill tool right away — never answer from memory, never skip, never defer.
Do not reply to bare acknowledgments ("OK", "thanks", "got it").`,
  },
);

let connection: BrokerConnection | null = null;
// 브로커가 발급한 UUID를 세션 메모리에 보관 — 재호출 시 리쥼과 send의 from에 쓴다(04 §3)
let storedUuid: string | undefined;

mcp.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: "register",
      description:
        "Register this session to the broker and receive an agent UUID. Re-run after a disconnect to resume the same UUID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          alias: { type: "string" as const, description: "Display name shown to peers" },
          status: { type: "string" as const, description: "One-line status shown to peers" },
        },
      },
    },
    {
      name: "send_message",
      description:
        "Send a message to another agent by UUID. Pass `skill` to instruct the recipient to run that skill with the message. Delivery succeeds only while the recipient is connected — otherwise the broker answers 'Peer not found'.",
      inputSchema: {
        type: "object" as const,
        properties: {
          to_id: { type: "string" as const, description: "Target agent UUID" },
          message: { type: "string" as const, description: "Message text to deliver" },
          skill: {
            type: "string" as const,
            description: "Optional. Name of a skill the recipient must execute with the message",
          },
        },
        required: ["to_id", "message"],
      },
    },
    {
      name: "list_peers",
      description: "List agents currently visible to you (same group exposure). Shows uuid, alias, and status.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "set_groups",
      description:
        "Narrow which groups you're exposed to. Groups you're not actually a member of are silently filtered out. There is no way to switch back to following all your groups — re-register to get that again.",
      inputSchema: {
        type: "object" as const,
        properties: {
          groups: { type: "array" as const, items: { type: "string" as const }, description: "Group IDs to expose to" },
        },
        required: ["groups"],
      },
    },
    {
      name: "list_groups",
      description:
        "Show your current group memberships, your exposure setting, and which groups you're actually exposed to.",
      inputSchema: { type: "object" as const, properties: {} },
    },
  ],
}));

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], ...(isError ? { isError: true } : {}) };
}

async function handleRegister(args: { alias?: string; status?: string }) {
  const brokerUrl = process.env[ENV_BROKER_URL];
  const token = process.env[ENV_BROKER_TOKEN];
  if (brokerUrl === undefined || token === undefined) {
    return textResult(`${ENV_BROKER_URL}, ${ENV_BROKER_TOKEN} 환경변수가 필요하다`, true);
  }

  try {
    connection?.close();
    connection = await registerWithBroker({
      brokerUrl,
      token,
      uuid: storedUuid,
      meta: { machine: hostname(), cwd: process.cwd(), alias: args.alias, status: args.status },
      onEvent: (event) => {
        const notification = toChannelNotification(event);
        if (notification !== null) mcp.notification(notification).catch(() => {});
      },
      // 끊기면 사용자에게 알린다(04 §1) — 재등록 여부·시점은 클라이언트 자율이므로 알림만 한다.
      onClose: () => {
        mcp
          .notification({
            method: "notifications/claude/channel",
            params: {
              content:
                "브로커와의 연결이 끊겼다. register를 다시 실행하면 보관된 UUID로 복귀를 시도한다. 사용자에게 이 사실을 알려라.",
              meta: { source: "agent-orchestra-system", sent_at: new Date().toISOString() },
            },
          })
          .catch(() => {});
      },
    });
    storedUuid = connection.uuid;
    return textResult(`registered: ${connection.uuid}`);
  } catch (e) {
    return textResult(`register failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

async function handleSendMessage(args: { to_id?: string; message?: string; skill?: string }) {
  const { to_id, message, skill } = args;
  if (typeof to_id !== "string" || typeof message !== "string") {
    return textResult("to_id and message are required.", true);
  }
  if (storedUuid === undefined) {
    return textResult("Not registered. Call register first.", true);
  }
  const brokerUrl = process.env[ENV_BROKER_URL];
  if (brokerUrl === undefined) {
    return textResult(`${ENV_BROKER_URL} 환경변수가 필요하다`, true);
  }

  try {
    const res = await fetch(new URL("/send", brokerUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: storedUuid, to: to_id, message, ...(skill !== undefined ? { skill } : {}) }),
    });
    if (!res.ok) {
      return textResult(`send failed: ${res.status} ${await res.text()}`.trim(), true);
    }
    const result = (await res.json()) as { ok: boolean; error?: string };
    if (!result.ok) {
      return textResult(`Send rejected: ${result.error}`, true);
    }
    return textResult(`Delivered to ${to_id}.`);
  } catch (e) {
    return textResult(`send_message failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

async function handleListPeers() {
  if (storedUuid === undefined) {
    return textResult("Not registered. Call register first.", true);
  }
  const brokerUrl = process.env[ENV_BROKER_URL];
  if (brokerUrl === undefined) {
    return textResult(`${ENV_BROKER_URL} 환경변수가 필요하다`, true);
  }

  try {
    const res = await fetch(new URL("/peers", brokerUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: storedUuid }),
    });
    if (!res.ok) {
      return textResult(`list_peers failed: ${res.status} ${await res.text()}`.trim(), true);
    }
    const result = (await res.json()) as {
      ok: boolean;
      error?: string;
      peers?: { uuid: string; meta: { alias?: string; status?: string } }[];
    };
    if (!result.ok) {
      return textResult(`list_peers rejected: ${result.error}`, true);
    }
    const peers = result.peers ?? [];
    if (peers.length === 0) return textResult("No peers visible.");
    const lines = peers.map((p) => `${p.uuid}  alias=${p.meta.alias ?? "-"}  status=${p.meta.status ?? "-"}`);
    return textResult(lines.join("\n"));
  } catch (e) {
    return textResult(`list_peers failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

async function handleSetGroups(args: { groups?: string[] }) {
  if (storedUuid === undefined) {
    return textResult("Not registered. Call register first.", true);
  }
  if (!Array.isArray(args.groups) || !args.groups.every((g) => typeof g === "string")) {
    return textResult("groups must be an array of strings.", true);
  }
  const brokerUrl = process.env[ENV_BROKER_URL];
  if (brokerUrl === undefined) {
    return textResult(`${ENV_BROKER_URL} 환경변수가 필요하다`, true);
  }

  try {
    const res = await fetch(new URL("/set-groups", brokerUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: storedUuid, groups: args.groups }),
    });
    if (!res.ok) {
      return textResult(`set_groups failed: ${res.status} ${await res.text()}`.trim(), true);
    }
    const result = (await res.json()) as { ok: boolean; error?: string };
    if (!result.ok) {
      return textResult(`set_groups rejected: ${result.error}`, true);
    }
    return textResult("Groups updated.");
  } catch (e) {
    return textResult(`set_groups failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

async function handleListGroups() {
  if (storedUuid === undefined) {
    return textResult("Not registered. Call register first.", true);
  }
  const brokerUrl = process.env[ENV_BROKER_URL];
  if (brokerUrl === undefined) {
    return textResult(`${ENV_BROKER_URL} 환경변수가 필요하다`, true);
  }

  try {
    const res = await fetch(new URL("/groups", brokerUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: storedUuid }),
    });
    if (!res.ok) {
      return textResult(`list_groups failed: ${res.status} ${await res.text()}`.trim(), true);
    }
    const result = (await res.json()) as {
      ok: boolean;
      error?: string;
      member_of?: { id: string; name: string }[];
      exposure?: "follow" | string[];
      exposed?: string[];
    };
    if (!result.ok) {
      return textResult(`list_groups rejected: ${result.error}`, true);
    }
    const memberOf = (result.member_of ?? []).map((g) => `${g.id} (${g.name})`).join(", ") || "-";
    const exposure = result.exposure === "follow" ? "follow" : `[${(result.exposure ?? []).join(", ")}]`;
    const exposed = (result.exposed ?? []).join(", ") || "-";
    return textResult(`member_of: ${memberOf}\nexposure: ${exposure}\nexposed: ${exposed}`);
  } catch (e) {
    return textResult(`list_groups failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = req.params.arguments ?? {};
  switch (req.params.name) {
    case "register":
      return handleRegister(args as { alias?: string; status?: string });
    case "send_message":
      return handleSendMessage(args as { to_id?: string; message?: string; skill?: string });
    case "list_peers":
      return handleListPeers();
    case "set_groups":
      return handleSetGroups(args as { groups?: string[] });
    case "list_groups":
      return handleListGroups();
    default:
      throw new Error(`unknown tool: ${req.params.name}`);
  }
});

if (import.meta.main) {
  await mcp.connect(new StdioServerTransport());
}
