// Better Auth 접점 격리 모듈(02 §2 교훈) — 다른 모듈은 이 파일이 내보내는 얇은 타입만 쓴다.
// 초대 게이트 후보 ①: 소셜 가입 하드 차단(disableSignUp) + 신뢰 프로바이더 자동 연결(accountLinking).
// 기존 email user의 첫 Google 로그인은 가입이 아니라 연결로 분류되어 통과한다 —
// 단, 연결 분기의 자체 게이트(requireLocalEmailVerified 기본 true)가 로컬 user의
// emailVerified=false를 거부하므로, 관리자 생성 사용자는 emailVerified=true로 만든다(ensureAdminUser).
import type { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin, jwt } from "better-auth/plugins";
import type { JSONWebKeySet } from "jose";
import { brokerDbPathFrom } from "../store/db";

// 토큰 만료 — 01 §3.1: 폐기·만료 없음, 유출 대응은 서명키 회전. 초장기 상수로 "사실상 없음"을 표현한다.
const TOKEN_EXPIRATION = "3650d";

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
  /** 요청 헤더에서 세션을 해석한다 — 세션 없으면 null(관리자 API #7의 인가 판정 근거). */
  getSessionUser(headers: Headers): Promise<AuthUser | null>;
  /** 일반 사용자(role: user)를 만든다 — emailVerified: true로 생성해 첫 소셜 로그인 연결 게이트를 통과시킨다. */
  createUser(email: string): Promise<AuthUser>;
  /** userId의 사용자를 삭제한다 — 존재하지 않으면 false. */
  deleteUser(userId: string): Promise<boolean>;
  /** 전체 사용자 목록. */
  listUsers(): Promise<AuthUser[]>;
  /** jwt 플러그인의 JWKS를 서버 내부 API로 얻는다(외부 네트워크 fetch 없음) — 브로커 검증기 부팅 시 1회 사용. */
  getJwks(): Promise<JSONWebKeySet>;
  /**
   * 세션 없이 user id로 서명된 JWT를 만든다 — jwt 플러그인의 server-only signJWT를 감싼다.
   * 실서버 흐름은 세션이 있는 /api/auth/token(getToken)이며, 이 메서드는 세션을 프로그램적으로
   * 만들기 어려운 테스트에서 같은 서명 경로(같은 키·알고리즘)를 그대로 태우기 위한 것이다.
   */
  issueTokenForUser(userId: string): Promise<string>;
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
    plugins: [
      admin(),
      // 브로커 검증기와 호환 필수: ES256. 만료는 초장기(위 TOKEN_EXPIRATION) — 01 §3.1.
      // sub 클레임은 기존 브로커 검증(sub만 읽음)과의 계약을 유지하기 위해 항상 user id로 고정한다.
      jwt({
        jwks: { keyPairConfig: { alg: "ES256" } },
        jwt: {
          expirationTime: TOKEN_EXPIRATION,
          getSubject: (session) => session.user.id,
          // 클레임 최소화 — 브로커는 sub만 읽으므로 user 객체 전체(email 등)를 담지 않는다.
          definePayload: () => ({}),
        },
      }),
    ],
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

    async getSessionUser(headers) {
      const session = await auth.api.getSession({ headers });
      return session === null ? null : toAuthUser(session.user);
    },

    async createUser(email) {
      const ctx = await auth.$context;
      const user = await ctx.internalAdapter.createUser({
        email,
        name: email,
        role: "user",
        emailVerified: true,
      });
      return toAuthUser(user);
    },

    async deleteUser(userId) {
      const ctx = await auth.$context;
      const existing = await ctx.internalAdapter.findUserById(userId);
      if (existing === null) return false;
      await ctx.internalAdapter.deleteUser(userId);
      return true;
    },

    async listUsers() {
      const ctx = await auth.$context;
      const users = await ctx.internalAdapter.listUsers();
      return users.map(toAuthUser);
    },

    async getJwks() {
      return (await auth.api.getJwks()) as JSONWebKeySet;
    },

    async issueTokenForUser(userId) {
      const { token } = await auth.api.signJWT({ body: { payload: { sub: userId } } });
      return token;
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
