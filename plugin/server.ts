// CC 플러그인 채널 서버(stdio MCP) — 슬라이스 1: register 도구까지. 인바운드 알림은 슬라이스 2에서.
import { hostname } from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { type BrokerConnection, registerWithBroker } from "./broker-client";
import { ENV_BROKER_TOKEN, ENV_BROKER_URL } from "./env";

const mcp = new Server({ name: "agent-orchestra-channel", version: "0.0.1" }, { capabilities: { tools: {} } });

let connection: BrokerConnection | null = null;
// 브로커가 발급한 UUID를 세션 메모리에 보관 — 재호출 시 리쥼에 쓴다(04 §3)
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
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "register") throw new Error(`unknown tool: ${req.params.name}`);

  const brokerUrl = process.env[ENV_BROKER_URL];
  const token = process.env[ENV_BROKER_TOKEN];
  if (brokerUrl === undefined || token === undefined) {
    return {
      content: [{ type: "text" as const, text: `${ENV_BROKER_URL}, ${ENV_BROKER_TOKEN} 환경변수가 필요하다` }],
      isError: true,
    };
  }

  const args = (req.params.arguments ?? {}) as { alias?: string; status?: string };
  try {
    connection?.close();
    connection = await registerWithBroker({
      brokerUrl,
      token,
      uuid: storedUuid,
      meta: { machine: hostname(), cwd: process.cwd(), alias: args.alias, status: args.status },
    });
    storedUuid = connection.uuid;
    return { content: [{ type: "text" as const, text: `registered: ${connection.uuid}` }] };
  } catch (e) {
    return {
      content: [{ type: "text" as const, text: `register failed: ${e instanceof Error ? e.message : String(e)}` }],
      isError: true,
    };
  }
});

if (import.meta.main) {
  await mcp.connect(new StdioServerTransport());
}
