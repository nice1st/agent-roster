# 02. 기술 검증 노트

> 조사·실행으로 확인한 사실 모음. 설계 결정은 각 설계 문서가 하고, 이 문서는 근거만 담는다.
> 검증 수준: **실행**(직접 실행 확인) > **원문**(라이브러리 소스·공식 문서) > **추정**(요약 기반 — 구현 시 재확인).
> 검증 시점: 2026-07.

## 1. 에이전트 3종 프로그래밍 구동 (OpenCode·Codex는 1차 범위 밖 — [00 §6](00-vision.md))

세 도구 모두 "프롬프트가 들어와야 턴이 돈다". 턴 종료를 아는 방법이 전부 다르므로 어댑터 정규화의 핵심은 이 표다:

| 도구 | 상주 형태 | 턴 주입 | 턴 종료 신호 | 최종 텍스트 |
|------|----------|---------|-------------|------------|
| Claude Code (`@anthropic-ai/claude-agent-sdk` 0.3.x) | 프로세스 상주 (SDK in-process) | inbox `AsyncIterable<SDKUserMessage>`에 push | generator의 `{type:'result'}` (매 턴 방출, 세션 유지) | `result.subtype==='success'`의 `result.result` |
| OpenCode (`opencode serve` + `@opencode-ai/sdk`) | 진짜 서버 상주 (서버 1개에 세션 N개) | `session.prompt()`(동기) / `promptAsync` | 동기: await 반환 / 비동기: 전역 이벤트의 `session.idle` | prompt 반환의 `parts` |
| Codex (`@openai/codex-sdk`) | **논리적 상주** — run마다 CLI spawn, 상태는 `thread.id`(~/.codex/sessions) | `thread.runStreamed(text)` | `{type:'turn.completed'}` (`turn.failed`=실패) | `item.completed` 중 `agent_message`의 `text` |

### Claude Code — 원문 검증
- `query({ prompt: AsyncIterable, options })` — iterable을 닫지 않는 한 세션 유지, 나중에 yield한 메시지가 새 턴. `SDKUserMessage`는 `{type:'user', message:{role:'user', content}}`.
- `createSdkMcpServer()` + `tool()`(Zod raw shape)로 도구를 프로세스 내 주입. 도구 ID는 `mcp__<서버명>__<도구명>`.
- 세션 복구: `system/init` 이벤트의 `session_id` 저장 → `options.resume`.
- `canUseTool` 거부: `{ behavior:'deny', message }`. 허용은 `updatedInput` 필수 반환.
- **V2 프리뷰(send/stream)는 0.3.142에서 제거됨** — 스트리밍 입력 query()가 유일한 공식 경로.
- **미해결 이슈 #368**: 스트리밍 첫 턴이 MCP 연결 전에 발사 — 첫 메시지 push 전 `q.mcpServerStatus()` 폴링 게이트 필요.
- SDK는 CLAUDE.md·settings를 기본 로드하지 않음(`settingSources`로 opt-in), 시스템 프롬프트 기본 빈 값. (추정)

### OpenCode — 원문 검증
- 기동 `opencode serve --port N --hostname 127.0.0.1`, 헬스체크 `GET /global/health`, OpenAPI는 `GET /doc`.
- `createOpencodeClient({ baseUrl, responseStyle: "data" })` — responseStyle에 따라 반환 접근이 달라지므로 "data" 고정 권장.
- 세션 생성 시 작업 디렉토리는 body가 아니라 **query 파라미터** `{query:{directory}}`.
- 이벤트 구독은 **전역 스트림 1개** — `properties.sessionID`로 클라이언트 측 디멀티플렉스.
- MCP 주입: `opencode.jsonc`의 `mcp` 또는 런타임 `POST /mcp` (body 세부는 추정 — `GET /doc`으로 대조).
- 인증은 `OPENCODE_SERVER_PASSWORD` Basic뿐 — localhost 바인드 필수. 릴리스 주기 빠름 — 버전 고정.

### Codex — 원문 검증 (SDK 소스)
- `codex.startThread({ workingDirectory, skipGitRepoCheck, sandboxMode, approvalPolicy })` → `thread.run/runStreamed`. 재개는 `codex.resumeThread(threadId)`.
- 무인 구동 조합: `sandboxMode:"workspace-write"` + `approvalPolicy:"never"`.
- **`env` 옵션 지정 시 process.env를 상속하지 않음** — PATH 누락으로 CLI 기동 실패 함정.
- 헬스체크 개념 없음 — `codex --version` 또는 startThread 성공으로 대체.
- 상시형 `codex app-server`(JSON-RPC 2.0)는 `experimentalApi` 뒤 실험 단계 — 1차 구현은 SDK, 배치 폴백은 `codex exec --json`.
- MCP 주입: `~/.codex/config.toml` `[mcp_servers.*]` — 사용자 전역 파일이라 머신 내 공유됨.

## 2. 인증 — Better Auth (v1.6.23)

### 기반 — 실행 검증

실제 설치·마이그레이션·가입·세션 해석까지 실행으로 확인:

- `betterAuth({ database: new Database(...) })` — **bun:sqlite Database 직접 수용**.
- `Bun.serve`의 fetch에 `auth.handler(req)` prefix 분기 한 줄로 마운트 (기본 basePath `/api/auth`).
- 스키마 생성: `bunx --bun @better-auth/cli@latest migrate`. **CLI 버전 함정**: `@better-auth/cli`는 본체와 버전이 따로 감(@1.6.23 태그 없음) — CLI는 `@latest`, 본체는 정확 버전 고정.
- minor 릴리스 breaking 전례 있음 — 정확 버전 고정 + auth 접점 모듈 1곳 격리.

### 에이전트 토큰 = 서명된 JWT — 원문 검증

[01 §3.1](01-domain-model.md)의 "토큰은 JWT로 user를 담아 서명, 검증만으로 확인"을 jwt 플러그인이 지원:

- jwt 플러그인은 서명된 JWT를 발급하고 공개키를 `/api/auth/jwks`로 노출 — **검증에 DB 조회·추가 API 호출 불필요**(공식 문서 명시).
- `definePayload`로 클레임 구성(user id·email 등), `expirationTime`·`issuer`·`audience`·`getSubject` 설정 가능.
- 토큰 발급 경로는 세션이 있는 요청 — "사용자가 웹(로그인 상태)에서 직접 토큰 생성"([00 §3](00-vision.md)) 흐름과 맞물림.
- 플러그인 공식 용도가 "세션 대체가 아니라 외부 서비스용 토큰" — regi 1회 인증이라는 용도와 부합.

### 초대 게이트 — 원문 검증

[00 §3](00-vision.md)의 "초대된 계정만 로그인 통과"를 옵션 조합으로 지원:

- 소셜 프로바이더별 `disableSignUp: true` = 신규 가입 하드 차단. `disableImplicitSignUp: true` = `requestSignUp` 명시 요청 시에만 생성. 세 OAuth 경로(빌트인 callback·generic OAuth·idToken)에 동일 로직(소스 확인).
- admin 플러그인 `createUser`로 관리자가 email 지정해 사용자 생성. **password가 필수 인자** — Google 로그인 전용 사용자도 무작위 더미 비밀번호가 필요.
- `accountLinking.trustedProviders: ["google"]` — 같은 email의 기존 user에 소셜 계정을 자동 연결. `disableImplicitLinking`으로 자동 연결을 끌 수 있음.
- (추정) "관리자 생성 계정 + 첫 Google 로그인"이 가입 차단에 걸리지 않고 연결 경로로 통과하는지 — `disableSignUp`과 accountLinking의 상호작용은 실행으로 재확인 필요.

## 3. Bun 런타임 스모크 (실행, Bun 1.3.11)

- **`Bun.randomUUIDv7()` 동일 ms 단조성 위반 존재** — 100만 회 연속 생성 중 198회 역전. 교훈: uuidv7은 식별자로만 쓰고, 정렬·커서·이벤트 재생 기준은 **삽입 순서 정수(sqlite rowid 등)** 를 별도로 둔다.
- `Bun.serve`의 `routes`(경로 파라미터 지원)가 우선 매칭되고, 미스는 `fetch` 콜백으로 폴백 — 신규 라우트와 레거시 라우팅의 공존 패턴으로 사용 가능.
- **`Bun.serve` 응답 스트림은 소켓 backpressure를 유저스페이스에 전파하지 않음** — 읽지 않는 소켓에 2MB를 밀어도 큐가 다음 tick에 비워져 `desiredSize`가 HWM에 고정(push), pull 스트림은 소켓 포화에도 pull을 무한 호출(OOM), direct `write()`는 항상 전량 기록 보고. `desiredSize`가 정확한 건 **같은 tick 안의 동기 버스트**뿐. 교훈: 미전송 큐 상한은 동기 버스트 범위에서만 동작하며, 여러 tick에 걸친 느린 수신자의 backlog는 Bun 네이티브 버퍼에 숨어 관측 불가.

## 4. Google Chat API (추정 — 문서 기반, 1차 범위 밖·구현 전 실검증 필요)

- incoming webhook: 단방향 전송 전용, UI 수동 생성만, Business/Enterprise 필요 — 데모 폴백용.
- Chat 앱(봇): 양방향. 발신은 `spaces.messages.create`(서비스 계정 + `chat.bot` 스코프, 자체 부여). 앱이 스페이스 멤버여야 하고, 자기가 만든 스페이스는 자동 멤버.
- **쿼터: 스페이스당 쓰기 초당 1건** — 실시간 중계에는 발언 병합(코얼레싱)이 사실상 필수. 프로젝트 전역 3000/분.
- 스레딩: `thread.threadKey` + `messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`. 멱등: `requestId`.
- **메시지 단위 발신자 이름/아바타 변경 불가**(Slack과 다름) — 발신자 구분은 cardsV2 헤더 또는 텍스트 접두어.
- 스페이스 전체 메시지 수신은 Workspace Events API 구독 → **Pub/Sub pull**(아웃바운드 연결이라 방화벽 뒤 동작). 구독 TTL 최대 7일 — 갱신 워커 + `spaceEvents.list` 백필 필요.
- 앱 @멘션/DM은 interaction event(HTTP POST, 30초 내 동기 응답) — 제어 커맨드 용도.
- 사람 멤버 추가(app auth)는 관리자 승인 + `chat.app.memberships` 스코프, **조직 외부 사용자 추가 불가**. 일부 스코프는 Preview 가능성.
- 루프 방지: 자기 앱 `sender.type==BOT` + 아웃바운드가 기록한 `message.name` 집합, 두 필터 모두 적용.

## 5. 계승 기반 실측 — claude-channel-peers 코드 스캔

브로커 119줄 + 핸들러 211줄 + MCP 플러그인 595줄 전수 확인. 계승·변경의 판단 기준은 [01](01-domain-model.md).

### 있는 것 (계승 가능한 검증 패턴)

| 패턴 | 세부 |
|------|------|
| regi = SSE | `POST /register` 응답 자체가 `text/event-stream` 스트림, 첫 이벤트 `registered` |
| 연결 맵 | 접속 중인 피어의 SSE 연결핸들을 브로커 인메모리 `Map`으로 보관 |
| 생존 관리 | keepalive 주석 프레임(`: keepalive`) 30초 주기, enqueue 실패 = 연결 제거. 같은 키 재등록 시 구 controller close 후 교체, `cancel()`은 현재 controller 동일성 비교 후에만 삭제(신구 연결 경쟁 방지). 사망 감지 지연은 주기만큼 |
| 릴레이 | send는 수신자에게 즉시 push, 발신자에게 성패 동기 응답. 저장 없음(수신자 오프라인이면 유실) |
| 동적 그룹 | 등록 후 `set_groups`로 그룹을 런타임 변경 |
| 상태 발행 | register 페이로드의 summary 필드 + 등록 후 `set_summary`(브로커 `/set-summary`)로 한 줄 상태 갱신 — peers 목록에 표시 |
| 위장 응답 | 차단·미존재를 "미존재와 동일한 문자열"로 응답 — 존재·권한·오프라인을 구분해 응답하면 그 자체가 정보 누설 |
| skill 지시 | send에 skill 실으면 수신측 채널 태그 속성 → MCP instructions가 실행 지시. 프롬프트 수준이라 하드 보장 아님 |
| 클라이언트 구조 | 세션당 MCP 채널 서버(stdio), 인바운드는 `notifications/claude/channel` |

### 계승 기반에 없는 것 (설계에서 신규)

- **인증 부재** — from_id 위조 방지 없음. 설계 노트에 "내부 도구 가정, 인증은 스코프 외"로 명시됨.
- **영속 부재** — 인메모리 Map뿐(SQLite 의도적 제거). 수신자 오프라인이면 유실, 재시작 시 레지스트리 소실.
- **정체성 부재** — 정체성이 호스트명 기반 `machine:alias` 메모리 키뿐(플러그인이 자칭). 브로커 발급 식별자·소유(user)·소유 검증 개념 없음.
- **팬아웃 부재** — send는 1:1 유니캐스트만.
- **연결 위생 부재** — 방어가 keepalive 실패 시 삭제 하나뿐. 연결 수 상한·연결별 큐 상한·유휴 타임아웃 없음.
