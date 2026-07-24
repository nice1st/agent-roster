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

export type RegisterResult = { ok: true; replaced: boolean } | { ok: false; reason: "owner-mismatch" | "broker-full" };

// UUID → 엔트리. agent 정체성은 이 Map이 전부다(01 §3.1) — 수명 = 연결.
export class Registry {
  private entries = new Map<string, RegistryEntry>();

  /** maxEntries = 프로세스당 연결 수 상한(01 §4 위생 ③). 기본 무제한 — 상한은 서버 조립부가 주입한다. */
  constructor(private readonly maxEntries: number = Number.POSITIVE_INFINITY) {}

  get(uuid: string): RegistryEntry | undefined {
    return this.entries.get(uuid);
  }

  get size(): number {
    return this.entries.size;
  }

  get isFull(): boolean {
    return this.entries.size >= this.maxEntries;
  }

  values(): IterableIterator<RegistryEntry> {
    return this.entries.values();
  }

  /**
   * 등재. 같은 UUID의 산 엔트리는 소유자가 같을 때만 연결을 교체한다 — 불일치는 거부(01 §3.1).
   * 교체는 총량 불변이므로 상한과 무관하고, 새 엔트리는 정원이 차 있으면 거부한다.
   */
  register(entry: RegistryEntry): RegisterResult {
    const existing = this.entries.get(entry.uuid);
    if (existing === undefined && this.isFull) return { ok: false, reason: "broker-full" };
    if (existing !== undefined) {
      if (existing.owner !== entry.owner) return { ok: false, reason: "owner-mismatch" };
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

  /** set_groups용 — 노출 의사만 덮어쓴다(01 §3.2). 엔트리가 없으면 false. */
  setExposure(uuid: string, exposure: Exposure): boolean {
    const existing = this.entries.get(uuid);
    if (existing === undefined) return false;
    existing.exposure = exposure;
    return true;
  }

  /** set_meta용 — 준 필드만 병합하고 나머지는 유지한다(슬라이스 9). 엔트리가 없으면 false. */
  mergeMeta(uuid: string, patch: Partial<AgentMeta>): boolean {
    const existing = this.entries.get(uuid);
    if (existing === undefined) return false;
    existing.meta = { ...existing.meta, ...patch };
    return true;
  }
}
