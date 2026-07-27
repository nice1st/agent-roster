import type { Registry } from "./registry";

export const KEEPALIVE_FRAME = ": keepalive\n\n";

export function sweepKeepalive(registry: Registry): void {
  for (const entry of registry.values()) {
    try {
      entry.handle.send(KEEPALIVE_FRAME);
    } catch {
      registry.removeIfCurrent(entry.uuid, entry.handle);
    }
  }
}
