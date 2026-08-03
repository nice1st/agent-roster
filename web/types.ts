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
  messages: ChatMessage[];
  unread: boolean;
  error: string | null;
}

export interface OpenRoom {
  name: string;
  status: "active" | "ended";
  messages: RoomChatMessage[];
  participants: RoomParticipantItem[];
  unread: boolean;
  error: string | null;
}

export type Selection = "agents" | "rooms" | "settings" | { dm: string } | { room: string };
