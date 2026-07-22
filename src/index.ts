import { existsSync } from "node:fs";
import type { JWK } from "jose";
import webIndex from "../web/index.html";
import { createAdminApiRoutes } from "./api/admin";
import { importPublicJwk } from "./auth/keys";
import { createJwtVerifier } from "./auth/token";
import { type AuthEnv, authEnvFrom, createWebAuth } from "./auth/web-auth";
import { hygieneFromEnv } from "./broker/hygiene";
import { startServer } from "./server";
import { openBrokerDatabase } from "./store/db";
import { runDomainMigrations } from "./store/migrations";

// 개발용 공개키 — #6에서 Better Auth JWKS로 교체된다
const PUBLIC_KEY_PATH = ".dev/es256.public.jwk.json";

if (import.meta.main) {
  if (!existsSync(PUBLIC_KEY_PATH)) {
    console.error(`공개키가 없다: ${PUBLIC_KEY_PATH} — 먼저 \`bun scripts/dev-token.ts <userId>\`로 키를 만들 것`);
    process.exit(1);
  }
  let authEnv: AuthEnv;
  try {
    authEnv = authEnvFrom(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  const jwk = (await Bun.file(PUBLIC_KEY_PATH).json()) as JWK;
  const verifier = createJwtVerifier(await importPublicJwk(jwk));
  const db = openBrokerDatabase(authEnv.dbPath);
  runDomainMigrations(db);
  const webAuth = createWebAuth({
    db,
    secret: authEnv.secret,
    google: { clientId: authEnv.googleClientId, clientSecret: authEnv.googleClientSecret },
  });
  const { server } = startServer({
    port: 3000,
    verifier,
    hygiene: hygieneFromEnv(process.env),
    webAuth,
    webRoutes: { "/": webIndex },
    adminRoutes: createAdminApiRoutes({ webAuth, db }),
  });
  console.log(`agent-orchestra listening on ${server.url}`);
}
