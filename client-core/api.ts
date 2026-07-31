export interface Peer {
  uuid: string;
  meta: { alias?: string; status?: string };
}

export interface GroupsView {
  memberOf: { id: string; name: string }[];
  exposure: "follow" | string[];
  exposed: string[];
}

async function post(
  brokerUrl: string,
  pathname: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(new URL(pathname, brokerUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${pathname} failed: ${res.status} ${await res.text()}`.trim());
  const result = (await res.json()) as { ok: boolean; error?: string } & Record<string, unknown>;
  if (!result.ok) throw new Error(`${pathname} rejected: ${result.error}`);
  return result;
}

export async function sendMessage(
  brokerUrl: string,
  from: string,
  to: string,
  message: string,
  skill?: string,
): Promise<void> {
  await post(brokerUrl, "/send", { from, to, message, ...(skill !== undefined ? { skill } : {}) });
}

export async function sendRoom(brokerUrl: string, from: string, room: string, message: string): Promise<void> {
  await post(brokerUrl, "/room-send", { from, room, message });
}

export async function listPeers(brokerUrl: string, from: string): Promise<Peer[]> {
  const result = (await post(brokerUrl, "/peers", { from })) as unknown as { peers?: Peer[] };
  return result.peers ?? [];
}

export async function setGroups(brokerUrl: string, from: string, groups: string[]): Promise<void> {
  await post(brokerUrl, "/set-groups", { from, groups });
}

export async function listGroups(brokerUrl: string, from: string): Promise<GroupsView> {
  const result = (await post(brokerUrl, "/groups", { from })) as unknown as {
    member_of?: { id: string; name: string }[];
    exposure?: "follow" | string[];
    exposed?: string[];
  };
  return { memberOf: result.member_of ?? [], exposure: result.exposure ?? "follow", exposed: result.exposed ?? [] };
}

export async function setMeta(brokerUrl: string, from: string, alias?: string, status?: string): Promise<void> {
  await post(brokerUrl, "/set-meta", { from, alias, status });
}

export function formatPeers(peers: Peer[]): string {
  if (peers.length === 0) return "No peers visible.";
  return peers.map((p) => `${p.uuid}  alias=${p.meta.alias ?? "-"}  status=${p.meta.status ?? "-"}`).join("\n");
}

export function formatGroups(view: GroupsView): string {
  const memberOf = view.memberOf.map((g) => `${g.id} (${g.name})`).join(", ") || "-";
  const exposure = view.exposure === "follow" ? "follow" : `[${view.exposure.join(", ")}]`;
  const exposed = view.exposed.join(", ") || "-";
  return `member_of: ${memberOf}\nexposure: ${exposure}\nexposed: ${exposed}`;
}
