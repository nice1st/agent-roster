export interface AgentMeta {
  machine?: string;
  cwd?: string;
  alias?: string;
  status?: string;
}

// 노출 의사 — "follow"는 소유자의 전 그룹 추종(01 §3.2), 배열은 set_groups로 고정된 목록.
export type Exposure = "follow" | string[];

export interface ConnectionHandle {
  send(chunk: string): void;
  close(): void;
}

export interface RegistryEntry {
  uuid: string;
  owner: string;
  exposure: Exposure;
  meta: AgentMeta;
  handle: ConnectionHandle;
}

// UUID → 엔트리. agent 정체성은 이 Map이 전부다(01 §3.1) — 수명 = 연결.
export class Registry {
  private entries = new Map<string, RegistryEntry>();

  get(uuid: string): RegistryEntry | undefined {
    return this.entries.get(uuid);
  }

  get size(): number {
    return this.entries.size;
  }

  /** 등재. 같은 UUID의 산 엔트리는 소유자가 같을 때만 연결을 교체한다 — 불일치가 유일한 거부 분기(01 §3.1). */
  register(entry: RegistryEntry): { ok: true; replaced: boolean } | { ok: false } {
    const existing = this.entries.get(entry.uuid);
    if (existing !== undefined) {
      if (existing.owner !== entry.owner) return { ok: false };
      existing.handle.close();
    }
    this.entries.set(entry.uuid, entry);
    return { ok: true, replaced: existing !== undefined };
  }

  /** 연결 종료 콜백용 — 그 사이 교체된 새 연결을 지우지 않도록 핸들 동일성을 비교하고 제거한다(계승 패턴). */
  removeIfCurrent(uuid: string, handle: ConnectionHandle): boolean {
    const existing = this.entries.get(uuid);
    if (existing === undefined || existing.handle !== handle) return false;
    this.entries.delete(uuid);
    return true;
  }
}
