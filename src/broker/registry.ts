export interface AgentMeta {
  machine?: string;
  cwd?: string;
  alias?: string;
  status?: string;
}

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

export class Registry {
  private entries = new Map<string, RegistryEntry>();

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

  removeIfCurrent(uuid: string, handle: ConnectionHandle): boolean {
    const existing = this.entries.get(uuid);
    if (existing === undefined || existing.handle !== handle) return false;
    this.entries.delete(uuid);
    return true;
  }

  setExposure(uuid: string, exposure: Exposure): boolean {
    const existing = this.entries.get(uuid);
    if (existing === undefined) return false;
    existing.exposure = exposure;
    return true;
  }

  mergeMeta(uuid: string, patch: Partial<AgentMeta>): boolean {
    const existing = this.entries.get(uuid);
    if (existing === undefined) return false;
    existing.meta = { ...existing.meta, ...patch };
    return true;
  }
}
