export const ENV_BROKER_URL = "ROSTER_BROKER_URL";
export const ENV_BROKER_TOKEN = "ROSTER_BROKER_TOKEN";

function isConfigured(value: string | undefined): value is string {
  if (value === undefined) return false;
  const trimmed = value.trim();
  return trimmed !== "" && !trimmed.startsWith("${"); // CC가 치환 못한 리터럴
}

export function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return isConfigured(value) ? value : undefined;
}

export function missingEnvMessage(names: string[], client = "CC"): string {
  return `${names.join(", ")} 환경변수가 필요하다 — ${client}를 띄운 셸에 export 후 재시작`;
}
