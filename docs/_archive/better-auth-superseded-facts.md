# Better Auth 검증 사실 — 대체된 설계의 근거 (읽기 전용 참고자료)

02-tech-notes §2에서 제거된 실행 검증 사실. 근거가 되던 설계(api-key 토큰, hd 도메인 게이트, 도메인→조직 매핑)가 JWT 토큰·초대 게이트로 대체되면서 걷어냈다. 검증 자체는 유효(실행, v1.6.23) — 해당 경로로 회귀할 때 재사용 가능.

- **hd 검증 네이티브**: `socialProviders.google.hd` 옵션이 인가 힌트 전송 + 서명된 id_token의 hd 클레임 강제(불일치 거부)를 수행. Workspace 도메인 단위로 로그인 게이트를 거는 용도.
- **hd 저장은 `databaseHooks.user.create.before` 단일 경로** — `user.additionalFields`에 `input:false`로 정의한 필드는 `mapProfileToUser` 반환값에서 조용히 스킵됨(소스 확인). 클라이언트가 body에 실으면 400 `FIELD_NOT_ALLOWED`.
- api-key 플러그인: 1.4부터 **별도 패키지 `@better-auth/api-key`**. `enableSessionForAPIKeys: true`(기본 off)를 켜야 키가 `auth.api.getSession({headers})`로 세션처럼 해석됨. 기본 헤더는 `x-api-key` — Bearer로 받으려면 `customAPIKeyGetter`.
- **키 기반 세션에는 `activeOrganizationId`가 없음(null)** — 에이전트 요청의 소속(user·그룹)은 member 테이블 조회 또는 키 metadata로 해석해야 함.
- `verifyApiKey`와 `getSession`을 같은 요청에 함께 쓰면 rate limit 2회 차감 — 하나만.
- 조직 조회(`listOrganizations`)는 세션 없이 Unauthorized — 도메인→조직 매핑은 sqlite 직접 쿼리로.
- 부트스트랩은 서버 전용 API로 세션 없이 가능: `auth.api.createOrganization({body:{..., userId}})`(첫 사용자 owner), `addMember`.
