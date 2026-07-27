import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";

// 테스트 전용 키·서명 헬퍼 — 운영 발급·검증은 Better Auth JWKS(web-auth.ts·jwks-verifier.ts).

export interface Es256KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export async function generateEs256KeyPair(): Promise<Es256KeyPair> {
  return generateKeyPair("ES256", { extractable: true });
}

export async function exportKeyPairJwk(pair: Es256KeyPair): Promise<{ publicJwk: JWK; privateJwk: JWK }> {
  return { publicJwk: await exportJWK(pair.publicKey), privateJwk: await exportJWK(pair.privateKey) };
}

export async function importPublicJwk(jwk: JWK): Promise<CryptoKey> {
  return (await importJWK(jwk, "ES256")) as CryptoKey;
}

export async function importPrivateJwk(jwk: JWK): Promise<CryptoKey> {
  return (await importJWK(jwk, "ES256")) as CryptoKey;
}

export async function signToken(
  privateKey: CryptoKey,
  userId: string,
  expiresInSeconds = 60 * 60 * 12,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(privateKey);
}
