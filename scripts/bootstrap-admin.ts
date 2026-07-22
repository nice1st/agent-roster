// 관리자 부트스트랩 — 사용법: bun scripts/bootstrap-admin.ts <email>
// 스키마를 적용하고(멱등) email의 admin role 사용자를 만든다. 이미 있으면 안내만 하고 성공 종료.
// 관리자 화면(#7) 전에 첫 관리자를 만드는 통로다(05 §3).
import { createWebAuth } from "../src/auth/web-auth";
import { brokerDbPathFrom, openBrokerDatabase } from "../src/store/db";

const email = process.argv[2];
if (email === undefined || !email.includes("@")) {
  console.error("사용법: bun scripts/bootstrap-admin.ts <email>");
  process.exit(1);
}

const secret = process.env.BETTER_AUTH_SECRET;
if (secret === undefined || secret.trim() === "") {
  console.error("인증 env 누락: BETTER_AUTH_SECRET");
  process.exit(1);
}

const dbPath = brokerDbPathFrom(process.env);
const webAuth = createWebAuth({ db: openBrokerDatabase(dbPath), secret });
await webAuth.runMigrations();
const result = await webAuth.ensureAdminUser(email);
console.log(
  result.created
    ? `admin 사용자 생성: ${result.user.email} (id: ${result.user.id}, db: ${dbPath})`
    : `이미 존재: ${result.user.email} (role: ${result.user.role}) — 생성하지 않음`,
);
