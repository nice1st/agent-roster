import webIndex from "../web/index.html";
import { createAdminApiRoutes } from "./api/admin";
import { createJwksVerifierFromWebAuth } from "./auth/jwks-verifier";
import { type AuthEnv, authEnvFrom, createWebAuth } from "./auth/web-auth";
import { hygieneFromEnv } from "./broker/hygiene";
import { startServer } from "./server";
import { openBrokerDatabase } from "./store/db";
import { runDomainMigrations } from "./store/migrations";

if (import.meta.main) {
  let authEnv: AuthEnv;
  try {
    authEnv = authEnvFrom(process.env);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  const db = openBrokerDatabase(authEnv.dbPath);
  runDomainMigrations(db);
  const webAuth = createWebAuth({
    db,
    secret: authEnv.secret,
    google: { clientId: authEnv.googleClientId, clientSecret: authEnv.googleClientSecret },
  });
  // 브로커 검증기의 키 출처 = 같은 프로세스의 Better Auth JWKS(부팅 시 1회 로드) — 키 회전은 재기동 전제(01 §3.1).
  const verifier = await createJwksVerifierFromWebAuth(webAuth);
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
