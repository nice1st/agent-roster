// Better Auth JWKS 기반 TokenVerifier — #6: 개발용 공개키 파일(.dev) 대신 같은 프로세스의
// Better Auth가 발급한 JWKS로 검증한다. 키 출처는 WebAuth.getJwks()(서버 내부 API,
// 외부 네트워크 fetch 없음) — 부팅 시 1회 로드하면 충분하다(키 회전은 재기동 전제, 01 §3.1).
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose";
import type { TokenVerifier } from "./token";
import type { WebAuth } from "./web-auth";

/** 이미 받아온 JWKS JSON으로 검증기를 만든다 — 순수 함수라 테스트하기 쉽다. */
export function createJwksVerifier(jwks: JSONWebKeySet): TokenVerifier {
  const keySet = createLocalJWKSet(jwks);
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, keySet, { algorithms: ["ES256"] });
        return typeof payload.sub === "string" && payload.sub !== "" ? { userId: payload.sub } : null;
      } catch {
        return null;
      }
    },
  };
}

/** webAuth에서 JWKS를 1회 가져와 검증기를 만든다 — 브로커 부팅 시 사용. */
export async function createJwksVerifierFromWebAuth(webAuth: WebAuth): Promise<TokenVerifier> {
  return createJwksVerifier(await webAuth.getJwks());
}
