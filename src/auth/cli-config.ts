// @better-auth/cli migrate 전용 설정 — 서버 구동과 무관하며 스키마 생성에만 쓴다.
// 사용: bun run auth:migrate (= bunx --bun @better-auth/cli@latest migrate -y --config src/auth/cli-config.ts)
// 시크릿은 스키마에 영향이 없으므로, migrate만 할 때는 placeholder로 대신한다(시크릿 값 아님).
import { betterAuth } from "better-auth";
import { brokerDbPathFrom, openBrokerDatabase } from "../store/db";
import { buildAuthOptions } from "./web-auth";

export const auth = betterAuth(
  buildAuthOptions({
    db: openBrokerDatabase(brokerDbPathFrom(process.env)),
    secret: process.env.BETTER_AUTH_SECRET ?? "migrate-only-placeholder",
  }),
);
