// 마켓플레이스 패키징 매니페스트(05 §2) 동작 테스트 — 형식이 깨지면 잡는다.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import rootPackageJson from "../package.json";
import { ENV_BROKER_TOKEN, ENV_BROKER_URL } from "./env";
import pluginPackageJson from "./package.json";

const REPO_ROOT = join(import.meta.dir, "..");

async function readJson(relativePath: string): Promise<unknown> {
  const text = await readFile(join(REPO_ROOT, relativePath), "utf-8");
  return JSON.parse(text);
}

test("marketplace.json은 유효한 JSON이고 name·owner·plugins를 갖는다", async () => {
  const manifest = (await readJson(".claude-plugin/marketplace.json")) as {
    name?: string;
    owner?: { name?: string };
    plugins?: unknown[];
  };
  expect(manifest.name).toBe("agent-roster");
  expect(manifest.owner?.name).toBe("nice1st");
  expect(Array.isArray(manifest.plugins)).toBe(true);
});

test("plugin.json은 유효한 JSON이고 name·version·mcpServers를 갖는다", async () => {
  const manifest = (await readJson("plugin/.claude-plugin/plugin.json")) as {
    name?: string;
    version?: string;
    mcpServers?: Record<string, unknown>;
  };
  expect(manifest.name).toBe("roster");
  expect(typeof manifest.version).toBe("string");
  expect(manifest.mcpServers?.roster).toBeDefined();
});

test("marketplace.json의 plugins[0].source 경로가 실제 존재한다", async () => {
  const manifest = (await readJson(".claude-plugin/marketplace.json")) as {
    plugins: { source: string }[];
  };
  const source = manifest.plugins[0]?.source;
  expect(source).toBeDefined();
  expect(existsSync(join(REPO_ROOT, source as string))).toBe(true);
});

test("plugin.json의 name·version이 plugin/package.json과 일치한다", async () => {
  const manifest = (await readJson("plugin/.claude-plugin/plugin.json")) as {
    name?: string;
    version?: string;
  };
  expect(manifest.name).toBe(pluginPackageJson.name);
  expect(manifest.version).toBe(pluginPackageJson.version);
});

test("plugin.json의 env 키들이 plugin/env.ts의 상수 값과 일치한다", async () => {
  const manifest = (await readJson("plugin/.claude-plugin/plugin.json")) as {
    mcpServers: { roster: { env?: Record<string, string> } };
  };
  const envKeys = Object.keys(manifest.mcpServers.roster.env ?? {});
  expect(envKeys.sort()).toEqual([ENV_BROKER_TOKEN, ENV_BROKER_URL].sort());
});

test("plugin/package.json의 sdk 버전이 루트 package.json의 sdk 버전과 일치한다", () => {
  expect(pluginPackageJson.dependencies["@modelcontextprotocol/sdk"]).toBe(
    rootPackageJson.dependencies["@modelcontextprotocol/sdk"],
  );
});

test("plugin.json의 version이 plugin/server.ts의 Server version과 일치한다", async () => {
  const manifest = (await readJson("plugin/.claude-plugin/plugin.json")) as { version?: string };
  const serverSource = await readFile(join(REPO_ROOT, "plugin/server.ts"), "utf-8");
  const match = serverSource.match(/name:\s*"agent-roster-channel",\s*version:\s*"([^"]+)"/);
  expect(match?.[1]).toBe(manifest.version);
});
