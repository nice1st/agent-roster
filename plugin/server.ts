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

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = req.params.arguments ?? {};
  switch (req.params.name) {
    case "register":
      return handleRegister(args as { alias?: string; status?: string });
    case "send_message":
      return handleSendMessage(args as { to_id?: string; message?: string; skill?: string });
    default:
      throw new Error(`unknown tool: ${req.params.name}`);
  }
});

if (import.meta.main) {
  await mcp.connect(new StdioServerTransport());
}
