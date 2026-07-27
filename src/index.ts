import webIndex from "../web/index.html";
import { createAdminApiRoutes } from "./api/admin";
import { createJwksVerifierFromWebAuth } from "./auth/jwks-verifier";
import { type AuthEnv, authEnvFrom, createWebAuth } from "./auth/web-auth";
import { hygieneFromEnv } from "./broker/hygiene";
import { startServer } from "./server";
import { openBrokerDatabase } from "./store/db";
import { createGroupStore } from "./store/groups";
import { runDomainMigrations } from "./store/migrations";
import { createRoomStore } from "./store/rooms";

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
  const verifier = await createJwksVerifierFromWebAuth(webAuth);
  const groups = createGroupStore(db);
  const rooms = createRoomStore(db);
  const { server } = startServer({
    port: 3000,
    verifier,
    hygiene: hygieneFromEnv(process.env),
    webAuth,
    webRoutes: { "/": webIndex },
    adminRoutes: createAdminApiRoutes({ webAuth, db }),
    groupsDeps: { getUserGroups: (userId) => groups.getGroupsForUser(userId) },
    agentsDeps: { webAuth, getUserGroups: (userId) => groups.getGroupsForUser(userId) },
    chatDeps: { webAuth },
    roomsDeps: { webAuth, rooms, getUserGroups: (userId) => groups.getGroupsForUser(userId) },
  });
  console.log(`agent-roster listening on ${server.url}`);
}
