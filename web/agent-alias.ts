import type { AgentListItem } from "./types";

export function aliasOf(agents: AgentListItem[], uuid: string): string {
  return agents.find((a) => a.uuid === uuid)?.meta.alias ?? uuid;
}
