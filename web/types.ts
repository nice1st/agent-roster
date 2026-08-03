export interface AgentMeta {
  machine?: string;
  cwd?: string;
  alias?: string;
  status?: string;
}

export interface AgentListItem {
  uuid: string;
  meta: AgentMeta;
  owner: { email: string };
}

export interface RoomListItem {
  id: string;
  name: string;
  context: string | null;
  status: "draft" | "active" | "ended";
  duration_minutes: number;
  ends_at: string | null;
  created_at: string;
  moderator_required: boolean;
  moderator_instruction: string | null;
}

export interface RoomParticipantItem {
  agent_uuid: string;
  alias_snapshot: string | null;
  persona: string | null;
  output_instruction?: string | null;
}

export interface ChatMessage {
  from: string;
  message: string;
  sentAt: string;
}

export interface RoomChatMessage {
  id?: number;
  from: string;
  fromLabel?: string;
  message: string;
  sentAt: string;
}

export interface Conversation {
  label: string;
  messages: ChatMessage[];
  unread: boolean;
}

export interface OpenRoom {
  name: string;
  status: "active" | "ended";
  messages: RoomChatMessage[];
  participants: RoomParticipantItem[];
  unread: boolean;
}

export type Selection = "agents" | "rooms" | "settings" | { dm: string } | { room: string };

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`요청 실패: ${url} (${res.status})`);
  return (await res.json()) as T;
}

export async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
