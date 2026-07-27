// @better-auth/cli migrate 전용 설정 — 시크릿은 스키마에 영향이 없어 migrate만 할 때는 placeholder로 충분하다.
import { betterAuth } from "better-auth";
import { brokerDbPathFrom, openBrokerDatabase } from "../store/db";
import { buildAuthOptions } from "./web-auth";

export const auth = betterAuth(
  buildAuthOptions({
    db: openBrokerDatabase(brokerDbPathFrom(process.env)),
    secret: process.env.BETTER_AUTH_SECRET ?? "migrate-only-placeholder",
  }),
);
