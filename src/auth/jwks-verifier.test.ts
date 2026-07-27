import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { startServer } from "../server";
import { createJwksVerifier, createJwksVerifierFromWebAuth } from "./jwks-verifier";
import { generateEs256KeyPair, signToken } from "./keys";
import { createWebAuth, type WebAuth } from "./web-auth";

// 실제 시크릿이 아니다 — 테스트 전용 더미 문자열.
const TEST_SECRET = "test-only-secret";

async function createMigratedWebAuth(): Promise<WebAuth> {
  const db = new Database(":memory:");
  const webAuth = createWebAuth({ db, secret: TEST_SECRET, baseURL: "http://localhost" });
  await webAuth.runMigrations();
  return webAuth;
}

test("JWKS 검증기는 다른 키로 서명된 토큰을 거부한다", async () => {
  const webAuth = await createMigratedWebAuth();
  // Better Auth의 실제 발급 경로(signJWT server-only)로 키를 최초 생성시킨다 — jwks 테이블 채우기.
  await webAuth.issueTokenForUser("u1");
  const verifier = await createJwksVerifierFromWebAuth(webAuth);

  const otherKeys = await generateEs256KeyPair();
  const foreignToken = await signToken(otherKeys.privateKey, "u1");

  expect(await verifier.verify(foreignToken)).toBeNull();
});

test("Better Auth가 발급한 JWT를 JWKS 검증기가 통과시켜 register가 성공한다", async () => {
  const webAuth = await createMigratedWebAuth();
  // 실서버 발급 경로(GET /api/auth/token)는 Google 로그인 세션 전제라 테스트 불가 — 같은 키·서명 경로인 server-only signJWT(issueTokenForUser)로 대신한다.
  const token = await webAuth.issueTokenForUser("u1");
  const verifier = await createJwksVerifierFromWebAuth(webAuth);

  const started = startServer({ port: 0, verifier });
  try {
    const res = await fetch(new URL("/register", started.server.url), {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);

    const reader = res.body?.getReader();
    if (reader === undefined) throw new Error("no body");
    const { value } = await reader.read();
    const frame: { type: string; uuid?: string } = JSON.parse(
      new TextDecoder().decode(value).slice("data: ".length).split("\n\n")[0] ?? "",
    );
    expect(frame).toEqual({ type: "registered", uuid: expect.any(String) });
  } finally {
    started.server.stop(true);
  }
});

test("직접 구성한 JWKS 검증기도 같은 키의 유효한 토큰을 통과시킨다", async () => {
  const webAuth = await createMigratedWebAuth();
  const token = await webAuth.issueTokenForUser("u1");
  const jwks = await webAuth.getJwks();
  const verifier = createJwksVerifier(jwks);

  expect(await verifier.verify(token)).toEqual({ userId: "u1" });
});
