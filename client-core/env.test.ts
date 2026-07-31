import { afterEach, beforeEach, expect, test } from "bun:test";
import { ENV_BROKER_URL, missingEnvMessage, readEnv } from "./env";

let original: string | undefined;

beforeEach(() => {
  original = process.env[ENV_BROKER_URL];
});

afterEach(() => {
  if (original === undefined) delete process.env[ENV_BROKER_URL];
  else process.env[ENV_BROKER_URL] = original;
});

test("빈 문자열 env는 없음으로 판정된다", () => {
  process.env[ENV_BROKER_URL] = "";
  expect(readEnv(ENV_BROKER_URL)).toBeUndefined();
});

test("공백뿐인 env는 없음으로 판정된다", () => {
  process.env[ENV_BROKER_URL] = "   ";
  expect(readEnv(ENV_BROKER_URL)).toBeUndefined();
});

test("CC가 치환하지 못한 달러중괄호 리터럴은 없음으로 판정된다", () => {
  process.env[ENV_BROKER_URL] = "$" + "{ROSTER_BROKER_URL:-}";
  expect(readEnv(ENV_BROKER_URL)).toBeUndefined();
});

test("env 자체가 설정되지 않은 경우도 없음으로 판정된다", () => {
  delete process.env[ENV_BROKER_URL];
  expect(readEnv(ENV_BROKER_URL)).toBeUndefined();
});

test("정상 값은 그대로 통과한다", () => {
  process.env[ENV_BROKER_URL] = "http://localhost:4000";
  expect(readEnv(ENV_BROKER_URL)).toBe("http://localhost:4000");
});

test("missingEnvMessage는 빠진 변수명만 나열한다", () => {
  expect(missingEnvMessage(["ROSTER_BROKER_URL"])).toBe(
    "ROSTER_BROKER_URL 환경변수가 필요하다 — CC를 띄운 셸에 export 후 재시작",
  );
  expect(missingEnvMessage(["ROSTER_BROKER_URL", "ROSTER_BROKER_TOKEN"])).toBe(
    "ROSTER_BROKER_URL, ROSTER_BROKER_TOKEN 환경변수가 필요하다 — CC를 띄운 셸에 export 후 재시작",
  );
});

test("missingEnvMessage는 클라이언트명을 받아 안내 문구에 싣는다", () => {
  expect(missingEnvMessage(["ROSTER_BROKER_URL"], "OpenCode")).toBe(
    "ROSTER_BROKER_URL 환경변수가 필요하다 — OpenCode를 띄운 셸에 export 후 재시작",
  );
});
