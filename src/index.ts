import { existsSync } from "node:fs";
import type { JWK } from "jose";
import { importPublicJwk } from "./auth/keys";
import { createJwtVerifier } from "./auth/token";
import { startServer } from "./server";

// 개발용 공개키 — #6에서 Better Auth JWKS로 교체된다
const PUBLIC_KEY_PATH = ".dev/es256.public.jwk.json";

if (import.meta.main) {
  if (!existsSync(PUBLIC_KEY_PATH)) {
    console.error(`공개키가 없다: ${PUBLIC_KEY_PATH} — 먼저 \`bun scripts/dev-token.ts <userId>\`로 키를 만들 것`);
    process.exit(1);
  }
  const jwk = (await Bun.file(PUBLIC_KEY_PATH).json()) as JWK;
  const verifier = createJwtVerifier(await importPublicJwk(jwk));
  const { server } = startServer({ port: 3000, verifier });
  console.log(`agent-orchestra listening on ${server.url}`);
}
