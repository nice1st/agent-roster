import { expect, test } from "bun:test";
import { HYGIENE_DEFAULTS, hygieneFromEnv, resolveHygiene } from "./hygiene";

test("오버라이드가 없으면 기본값 30초·1000연결로 해석된다", () => {
  expect(resolveHygiene()).toEqual({ keepaliveIntervalMs: 30_000, maxConnections: 1_000 });
});

test("부분 오버라이드는 지정한 값만 바꾸고 나머지는 기본값을 쓴다", () => {
  expect(resolveHygiene({ maxConnections: 5 })).toEqual({ ...HYGIENE_DEFAULTS, maxConnections: 5 });
});

test("env가 비어 있으면 오버라이드도 비어 있다", () => {
  expect(hygieneFromEnv({})).toEqual({});
});

test("BROKER_ env 2종을 숫자 오버라이드로 파싱한다", () => {
  const env = {
    BROKER_KEEPALIVE_INTERVAL_MS: "5000",
    BROKER_MAX_CONNECTIONS: "10",
  };
  expect(hygieneFromEnv(env)).toEqual({ keepaliveIntervalMs: 5000, maxConnections: 10 });
});

test("빈 문자열 env는 미설정으로 취급한다", () => {
  expect(hygieneFromEnv({ BROKER_MAX_CONNECTIONS: "" })).toEqual({});
});

test("숫자가 아닌 env 값은 변수명을 담은 에러로 즉시 실패한다", () => {
  expect(() => hygieneFromEnv({ BROKER_MAX_CONNECTIONS: "10x" })).toThrow("BROKER_MAX_CONNECTIONS");
});

test("0 이하의 env 값은 거부한다", () => {
  expect(() => hygieneFromEnv({ BROKER_KEEPALIVE_INTERVAL_MS: "0" })).toThrow();
});
