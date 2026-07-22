import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";

// 개발·테스트용 ES256 키쌍과 토큰 발급 헬퍼.
// 운영 발급은 #6에서 Better Auth로 간다 — 브로커는 발급하지 않고 검증만 한다.

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
