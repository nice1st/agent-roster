// 연결 위생 설정 — 코드 기본값과 env 오버라이드. 시간·상한은 주입으로 결정론을 확보한다(05 §4).

export interface HygieneConfig {
  heartbeatIntervalMs: number;
  maxConnections: number;
}

export type HygieneOverrides = Partial<HygieneConfig>;

export const HYGIENE_DEFAULTS: HygieneConfig = {
  heartbeatIntervalMs: 30_000,
  maxConnections: 1_000,
};

export function resolveHygiene(overrides: HygieneOverrides = {}): HygieneConfig {
  return {
    heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? HYGIENE_DEFAULTS.heartbeatIntervalMs,
    maxConnections: overrides.maxConnections ?? HYGIENE_DEFAULTS.maxConnections,
  };
}

const ENV_KEYS: Record<keyof HygieneConfig, string> = {
  heartbeatIntervalMs: "BROKER_HEARTBEAT_INTERVAL_MS",
  maxConnections: "BROKER_MAX_CONNECTIONS",
};

/** env에서 오버라이드를 읽는 순수 함수 — 미설정·빈 값은 생략하고, 양의 정수가 아니면 즉시 실패한다. */
export function hygieneFromEnv(env: Record<string, string | undefined>): HygieneOverrides {
  const overrides: HygieneOverrides = {};
  for (const field of Object.keys(ENV_KEYS) as (keyof HygieneConfig)[]) {
    const key = ENV_KEYS[field];
    const raw = env[key];
    if (raw === undefined || raw.trim() === "") continue;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${key}는 양의 정수여야 한다 — 현재 값: "${raw}"`);
    }
    overrides[field] = value;
  }
  return overrides;
}
