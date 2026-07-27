import { jwtVerify } from "jose";

export interface AuthContext {
  userId: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthContext | null>;
}

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
