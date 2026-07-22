// Better Auth 접점 격리 모듈(02 §2 교훈) — 다른 모듈은 이 파일이 내보내는 얇은 타입만 쓴다.
// 초대 게이트 후보 ①: 소셜 가입 하드 차단(disableSignUp) + 신뢰 프로바이더 자동 연결(accountLinking).
// 기존 email user의 첫 Google 로그인은 가입이 아니라 연결로 분류되어 통과한다 —
// 단, 연결 분기의 자체 게이트(requireLocalEmailVerified 기본 true)가 로컬 user의
// emailVerified=false를 거부하므로, 관리자 생성 사용자는 emailVerified=true로 만든다(ensureAdminUser).
import type { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin } from "better-auth/plugins";
import { brokerDbPathFrom } from "../store/db";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

export interface WebAuthConfig {
  db: Database;
  secret: string;
  /** 없으면 소셜 로그인 없이 구동한다 — 부트스트랩·테스트용. */
  google?: GoogleCredentials;
  /** 없으면 요청 origin에서 파생(BETTER_AUTH_URL env가 있으면 그쪽 우선) — 테스트가 경고 없이 돌도록 주입용. */
  baseURL?: string;
}

export interface EnsureAdminResult {
  created: boolean;
  user: AuthUser;
}

export interface WebAuth {
  /** /api/auth/* 요청을 처리한다 — 서버는 이 함수만 마운트한다. */
  handler(req: Request): Promise<Response>;
  /** Better Auth 스키마를 적용한다(멱등). 운영 경로는 CLI migrate(05 §4), 테스트·부트스트랩이 이걸 쓴다. */
  runMigrations(): Promise<void>;
  /** email의 admin role 사용자를 보장한다 — 이미 있으면 created:false로 기존 사용자를 돌려준다. */
  ensureAdminUser(email: string): Promise<EnsureAdminResult>;
}

/** Better Auth 옵션 조립 — createWebAuth와 CLI migrate 설정(cli-config.ts)이 공유하는 단일 출처. */
export function buildAuthOptions(config: WebAuthConfig) {
  return {
    database: config.db,
    secret: config.secret,
    baseURL: config.baseURL,
    socialProviders:
      config.google === undefined
        ? {}
        : {
            google: {
              clientId: config.google.clientId,
              clientSecret: config.google.clientSecret,
              disableSignUp: true,
            },
          },
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    plugins: [admin()],
  };
}

export function createWebAuth(config: WebAuthConfig): WebAuth {
  const options = buildAuthOptions(config);
  const auth = betterAuth(options);

  return {
    handler: (req) => auth.handler(req),

    async runMigrations() {
      const { runMigrations } = await getMigrations(options);
      await runMigrations();
    },

    async ensureAdminUser(email) {
      const ctx = await auth.$context;
      const existing = await ctx.internalAdapter.findUserByEmail(email);
      if (existing !== null) {
        return { created: false, user: toAuthUser(existing.user) };
      }
      const { user } = await auth.api.createUser({
        body: {
          email,
          name: email,
          role: "admin",
          // Google 로그인 전용이라도 password가 필요하다(02 §2) — 아무도 모르는 무작위 더미.
          // emailAndPassword를 켜지 않으므로 이 값으로 로그인할 경로는 없다.
          password: crypto.randomUUID() + crypto.randomUUID(),
          // 연결 게이트 전제 — requireLocalEmailVerified(기본 true)가 emailVerified=false인
          // 로컬 user의 소셜 연결을 거부하므로, 관리자가 만든 계정은 검증된 것으로 둔다.
          data: { emailVerified: true },
        },
      });
      return { created: true, user: toAuthUser(user) };
    },
  };
}

function toAuthUser(user: { id: string; email: string; role?: string | null }): AuthUser {
  return { id: user.id, email: user.email, role: user.role ?? "user" };
}

export interface AuthEnv {
  googleClientId: string;
  googleClientSecret: string;
  secret: string;
  dbPath: string;
}

/** env에서 인증 설정을 읽는 순수 함수 — 필수 키가 하나라도 없으면 누락 키를 나열하며 즉시 실패한다. */
export function authEnvFrom(env: Record<string, string | undefined>): AuthEnv {
  const missing: string[] = [];
  const read = (key: string): string => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === "") {
      missing.push(key);
      return "";
    }
    return raw;
  };
  const googleClientId = read("GOOGLE_CLIENT_ID");
  const googleClientSecret = read("GOOGLE_CLIENT_SECRET");
  const secret = read("BETTER_AUTH_SECRET");
  if (missing.length > 0) {
    throw new Error(`인증 env 누락: ${missing.join(", ")}`);
  }
  return { googleClientId, googleClientSecret, secret, dbPath: brokerDbPathFrom(env) };
}
