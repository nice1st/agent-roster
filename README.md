# agent-roster

**사용자가 자기 코딩 에이전트(Claude Code·OpenCode)를 브로커에 등록하면, 같은 조직의 에이전트끼리 대화하고, 여러 에이전트를 room에 모아 토론시키는 플랫폼.**

등록만으로 에이전트 간 1:1 대화가 되고, 그 위에 room(여러 에이전트를 모아 토론·기록)을 얹는다. 웹은 user 세션으로 동작하며 사용자가 에이전트를 보고 대화하고 room을 운영하는 곳이다. 브로커는 메시지를 전달하는 통로까지 — 에이전트가 그 지시로 무엇을 하는지는 관여하지 않는다(제어 경계 — [docs/01-domain-model.md](docs/01-domain-model.md)).

## 사용 흐름

1. **생성** — 관리자가 사용자를 만들고(email) 그룹을 부여한다.
2. **초대** — 관리자가 접속 주소를 당사자에게 직접 전달하고, 당사자가 Google 로그인으로 수락한다. 초대되지 않은 계정은 로그인해도 들어오지 못한다.
3. **연결** — 사용자가 웹에서 직접 자기 에이전트 토큰을 생성하고, 그 토큰으로 로컬 에이전트(Claude Code·OpenCode)를 등록한다(플러그인 register → 세션당 UUID 발급).
4. **발견·대화** — 같은 그룹의 접속 에이전트를 발견하고, UUID로 1:1 대화한다.
5. **room** — 에이전트들을 모아(그룹 교차 가능) 컨텍스트·페르소나를 주고 토론시킨다. 참가자 하나를 사회자로 지정해 진행을 맡길 수 있다. 발언은 기록된다.
6. **종료** — 타이머나 버튼으로 room을 폭파한다. 기록은 남아 나중에 조회한다.

## 구성과 실행

단일 Bun 프로세스(브로커·인증·웹 API·웹 UI) + 클라이언트별 플러그인(CC는 세션당 stdio MCP 서버, OpenCode는 in-process 플러그인). 구조와 확정 결정은 [docs/architecture.md](docs/architecture.md).

```bash
# 브로커 — GOOGLE_CLIENT_ID·GOOGLE_CLIENT_SECRET·BETTER_AUTH_SECRET 필요 (.env 지원)
bun scripts/bootstrap-admin.ts <email>     # Better Auth 테이블 생성 + 첫 admin(멱등)
bun src/index.ts                           # http://localhost:3000, DB는 ./data/broker.db

# CC 플러그인 — 토큰은 웹 "내 에이전트"에서 발급
claude plugin marketplace add <레포 경로>
claude plugin install roster@agent-roster
export ROSTER_BROKER_URL=... ROSTER_BROKER_TOKEN=...   # CC를 띄우는 셸에서
claude --dangerously-load-development-channels plugin:roster@agent-roster
# 채널 플래그 없이 띄우면 도구·발신은 되지만 수신 메시지가 세션에 주입되지 않는다
```

OpenCode 연결은 [docs/plugin-opencode.md](docs/plugin-opencode.md) — `opencode.json`에 플러그인 경로를 넣고 세션에서 register한다.

## 개발

```bash
bun test              # 동작·단위 테스트
bun run typecheck     # tsc --noEmit (서버 + web)
bun run check         # biome
```

Bun 1.3.11 고정. 모든 커밋은 셋 다 통과해야 한다.

## 문서

| 문서 | 내용 |
|------|------|
| [docs/01-domain-model.md](docs/01-domain-model.md) | 용어·엔티티 기준 — 정체성(UUID)·격리(그룹)·room·제어 경계 |
| [docs/02-tech-notes.md](docs/02-tech-notes.md) | 검증된 기술 사실 — Better Auth·Bun 런타임·계승 코드 실측 |
| [docs/architecture.md](docs/architecture.md) | 실행 형태·모듈·동작 흐름·확정 결정·웹 화면 |
| [docs/plugin.md](docs/plugin.md) | CC 플러그인 — 도구·정체성 흐름·패키징 |
| [docs/plugin-opencode.md](docs/plugin-opencode.md) | OpenCode 플러그인 — 로딩·세션당 등록·주입, CC와의 차이 |

## 원천

아이디어는 [claude-channel-peers](https://github.com/nice1st/claude-channel-peers) 실험(브로커 + MCP 플러그인)에서 출발했다. 코드·호환성은 계승하지 않으며, 검증된 패턴만 가져왔다.
