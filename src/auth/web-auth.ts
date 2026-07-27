import type { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin, jwt } from "better-auth/plugins";
import type { JSONWebKeySet } from "jose";
import { brokerDbPathFrom } from "../store/db";

// 만료는 사실상 두지 않는다 — 유출 대응은 서명키 회전(전체 토큰 일괄 무효화).
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
  google?: GoogleCredentials;
  baseURL?: string;
}

export interface EnsureAdminResult {
  created: boolean;
  user: AuthUser;
}

export interface WebAuth {
  handler(req: Request): Promise<Response>;
  runMigrations(): Promise<void>;
  ensureAdminUser(email: string): Promise<EnsureAdminResult>;
  getSessionUser(headers: Headers): Promise<AuthUser | null>;
  createUser(email: string): Promise<AuthUser>;
  deleteUser(userId: string): Promise<boolean>;
  listUsers(): Promise<AuthUser[]>;
  getJwks(): Promise<JSONWebKeySet>;
  /** 테스트 전용 — 실서버 발급은 세션이 있는 GET /api/auth/token. */
  issueTokenForUser(userId: string): Promise<string>;
}

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
      jwt({
        jwks: { keyPairConfig: { alg: "ES256" } },
        jwt: {
          expirationTime: TOKEN_EXPIRATION,
          getSubject: (session) => session.user.id,
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
          // 생성 API가 password를 요구한다 — emailAndPassword를 켜지 않으므로 이 무작위 더미로 로그인할 경로는 없다.
          password: crypto.randomUUID() + crypto.randomUUID(),
          // requireLocalEmailVerified(기본 true)가 emailVerified=false인 로컬 user의 소셜 연결을 거부한다 — 실물 Google 로그인에서만 드러난다.
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
