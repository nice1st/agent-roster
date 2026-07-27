import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose";
import type { TokenVerifier } from "./token";
import type { WebAuth } from "./web-auth";

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

// JWKS는 부팅 시 1회 로드로 충분하다 — 키 회전은 재기동 전제.
export async function createJwksVerifierFromWebAuth(webAuth: WebAuth): Promise<TokenVerifier> {
  return createJwksVerifier(await webAuth.getJwks());
}
