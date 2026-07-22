import { jwtVerify } from "jose";

export interface AuthContext {
  userId: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthContext | null>;
}

// 공개키만 주입받는 검증기 — 발급자가 누구든(개발 스크립트, 이후 Better Auth JWKS) 계약은 동일하다.
export function createJwtVerifier(publicKey: CryptoKey): TokenVerifier {
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, publicKey, { algorithms: ["ES256"] });
        return typeof payload.sub === "string" && payload.sub !== "" ? { userId: payload.sub } : null;
      } catch {
        return null;
      }
    },
  };
}
