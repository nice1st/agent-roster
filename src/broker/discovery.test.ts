import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { type Es256KeyPair, generateEs256KeyPair, signToken } from "../auth/keys";
import { createJwtVerifier } from "../auth/token";
import { startServer } from "../server";
import { createGroupStore, type GroupStore } from "../store/groups";
import { runDomainMigrations } from "../store/migrations";

let keys: Es256KeyPair;
let db: Database;
let groups: GroupStore;
let started: ReturnType<typeof startServer>;

beforeEach(async () => {
  keys = await generateEs256KeyPair();
  db = new Database(":memory:");
  runDomainMigrations(db);
  groups = createGroupStore(db);
  started = startServer({
    port: 0,
    verifier: createJwtVerifier(keys.publicKey),
    groupsDeps: { getUserGroups: (userId) => groups.getGroupsForUser(userId) },
  });
});

afterEach(() => {
  started.server.stop(true);
});

async function registerAgent(userId: string): Promise<string> {
  const res = await fetch(new URL("/register", started.server.url), {
    method: "POST",
    headers: { authorization: `Bearer ${await signToken(keys.privateKey, userId)}` },
    body: "{}",
  });
  if (res.body === null) throw new Error("no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (!buf.includes("\n\n")) {
    const { done, value } = await reader.read();
    if (done) throw new Error("stream ended without frame");
    buf += decoder.decode(value, { stream: true });
  }
  const frame = JSON.parse(buf.slice("data: ".length, buf.indexOf("\n\n"))) as { uuid: string };
  return frame.uuid;
}

function peers(from: string): Promise<Response> {
  return fetch(new URL("/peers", started.server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from }),
  });
}

function setGroups(from: string, groupIds: string[]): Promise<Response> {
  return fetch(new URL("/set-groups", started.server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from, groups: groupIds }),
  });
}

function groupsOf(from: string): Promise<Response> {
  return fetch(new URL("/groups", started.server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from }),
  });
}

test("같은 그룹에 노출된 두 에이전트는 서로의 peers에 보인다", async () => {
  const g1 = groups.create("g1");
  groups.grant("u1", g1.id);
  groups.grant("u2", g1.id);
  const a1 = await registerAgent("u1");
  const a2 = await registerAgent("u2");

  const res1 = (await (await peers(a1)).json()) as { peers: { uuid: string }[] };
  const res2 = (await (await peers(a2)).json()) as { peers: { uuid: string }[] };
  expect(res1.peers.map((p) => p.uuid).sort()).toEqual([a1, a2].sort());
  expect(res2.peers.map((p) => p.uuid).sort()).toEqual([a1, a2].sort());
});

test("set_groups로 좁히면 그 그룹 밖 peer에게 보이지 않는다", async () => {
  const g1 = groups.create("g1");
  const g2 = groups.create("g2");
  groups.grant("u1", g1.id);
  groups.grant("u1", g2.id);
  groups.grant("u2", g1.id);
  const a1 = await registerAgent("u1");
  const a2 = await registerAgent("u2");

  await setGroups(a1, [g2.id]);

  const res2 = (await (await peers(a2)).json()) as { peers: { uuid: string }[] };
  expect(res2.peers.map((p) => p.uuid)).not.toContain(a1);
});

test("소속에 없는 그룹을 지정해도 노출되지 않는다", async () => {
  const g1 = groups.create("g1");
  const other = groups.create("other");
  groups.grant("u1", g1.id);
  groups.grant("u2", g1.id);
  const a1 = await registerAgent("u1");
  const a2 = await registerAgent("u2");

  await setGroups(a1, [other.id]);

  const res2 = (await (await peers(a2)).json()) as { peers: { uuid: string }[] };
  expect(res2.peers.map((p) => p.uuid)).not.toContain(a1);
});

test("관리자가 소속을 회수하면 다음 조회부터 노출이 사라진다", async () => {
  const g1 = groups.create("g1");
  groups.grant("u1", g1.id);
  groups.grant("u2", g1.id);
  const a1 = await registerAgent("u1");
  const a2 = await registerAgent("u2");

  const before = (await (await peers(a2)).json()) as { peers: { uuid: string }[] };
  expect(before.peers.map((p) => p.uuid)).toContain(a1);

  groups.revoke("u1", g1.id);

  const after = (await (await peers(a2)).json()) as { peers: { uuid: string }[] };
  expect(after.peers.map((p) => p.uuid)).not.toContain(a1);
});

test("그룹이 없는 user의 에이전트는 빈 목록을 받는다", async () => {
  const a1 = await registerAgent("u-no-group");
  const res = (await (await peers(a1)).json()) as { peers: unknown[] };
  expect(res.peers).toEqual([]);
});

test("노출이 비어있지 않으면 자기 자신이 목록에 포함된다", async () => {
  const g1 = groups.create("g1");
  groups.grant("u1", g1.id);
  const a1 = await registerAgent("u1");

  const res = (await (await peers(a1)).json()) as { peers: { uuid: string }[] };
  expect(res.peers.map((p) => p.uuid)).toEqual([a1]);
});

test("groups 조회가 member_of·exposure·exposed를 돌려준다", async () => {
  const g1 = groups.create("g1");
  const g2 = groups.create("g2");
  groups.grant("u1", g1.id);
  groups.grant("u1", g2.id);
  const a1 = await registerAgent("u1");

  const res = (await (await groupsOf(a1)).json()) as {
    member_of: { id: string; name: string }[];
    exposure: string;
    exposed: string[];
  };
  expect(res.member_of.map((g) => g.id).sort()).toEqual([g1.id, g2.id].sort());
  expect(res.exposure).toBe("follow");
  expect(res.exposed.sort()).toEqual([g1.id, g2.id].sort());

  await setGroups(a1, [g1.id]);
  const res2 = (await (await groupsOf(a1)).json()) as { exposure: string[]; exposed: string[] };
  expect(res2.exposure).toEqual([g1.id]);
  expect(res2.exposed).toEqual([g1.id]);
});

test("미등록 from은 Peer not found — peers", async () => {
  const res = await peers(crypto.randomUUID());
  expect(await res.json()).toEqual({ ok: false, error: "Peer not found" });
});

test("미등록 from은 Peer not found — set-groups", async () => {
  const res = await setGroups(crypto.randomUUID(), []);
  expect(await res.json()).toEqual({ ok: false, error: "Peer not found" });
});

test("미등록 from은 Peer not found — groups", async () => {
  const res = await groupsOf(crypto.randomUUID());
  expect(await res.json()).toEqual({ ok: false, error: "Peer not found" });
});
