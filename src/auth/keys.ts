import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";

// 테스트 픽스처 — ES256 키쌍과 토큰 발급 헬퍼.
// 운영 발급·검증은 #6에서 Better Auth(jwt 플러그인·JWKS)로 이전됐다(auth/web-auth.ts·auth/jwks-verifier.ts).
// 이 모듈은 register.test.ts 등에서 "다른 키로 서명된 토큰은 거부된다" 같은 검증기 동작을
// 실제 서버 없이 빠르게 확인하기 위한 테스트 전용 키·서명 헬퍼로 남는다.

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
