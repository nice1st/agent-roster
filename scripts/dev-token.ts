// 개발용 토큰 발급 — 사용법: bun scripts/dev-token.ts <userId>
// .dev/에 ES256 키쌍이 없으면 생성한다. 운영 발급은 #6에서 Better Auth로 대체된다.
import { existsSync, mkdirSync } from "node:fs";
import type { JWK } from "jose";
import { exportKeyPairJwk, generateEs256KeyPair, importPrivateJwk, signToken } from "../src/auth/keys";

const DIR = ".dev";
const PRIVATE_PATH = `${DIR}/es256.private.jwk.json`;
const PUBLIC_PATH = `${DIR}/es256.public.jwk.json`;

const userId = process.argv[2];
if (userId === undefined || userId === "") {
  console.error("사용법: bun scripts/dev-token.ts <userId>");
  process.exit(1);
}

if (!existsSync(PRIVATE_PATH)) {
  mkdirSync(DIR, { recursive: true });
  const pair = await generateEs256KeyPair();
  const { publicJwk, privateJwk } = await exportKeyPairJwk(pair);
  await Bun.write(PRIVATE_PATH, JSON.stringify(privateJwk, null, 2));
  await Bun.write(PUBLIC_PATH, JSON.stringify(publicJwk, null, 2));
  console.error(`키쌍 생성: ${PRIVATE_PATH}, ${PUBLIC_PATH}`);
}

const privateJwk = (await Bun.file(PRIVATE_PATH).json()) as JWK;
console.log(await signToken(await importPrivateJwk(privateJwk), userId));
