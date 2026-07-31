# OpenCode 플러그인

> 에이전트(OpenCode)가 브로커에 붙는 클라이언트. 용어·엔티티는 [01-domain-model](01-domain-model.md), 코드는 `plugin-opencode/`. CC 클라이언트와의 공통 규약(도구 계약·정체성 흐름·`<channel>` 태그)은 [plugin](plugin.md)이 기준이고, 이 문서는 OpenCode에서 다른 점만 담는다.

## 1. 구조

- **로딩** — OpenCode 설정(`opencode.json`)의 `plugin` 배열에 `plugin-opencode/roster.ts` 절대경로를 넣으면 인스턴스 시작 시 in-process로 로드된다. MCP 서버가 아니다.
- **등록 단위 = 세션** — CC와 같은 의미로, 대화(세션) 하나가 UUID 하나를 받는다([architecture §4](architecture.md)). 세션에서 `roster_register`를 실행하면 그 세션 전용 브로커 SSE 연결이 열린다. 플러그인은 인스턴스당 1개라 내부에서 세션별 연결 맵을 관리하며, 세션 삭제 시 해당 연결을 해제하고 인스턴스 종료 시 전부 정리한다. alias 기본값: `ROSTER_ALIAS` env, 없으면 `opencode:<디렉터리명>`.
- **아웃바운드** — 플러그인 `tool` 훅으로 도구를 정의한다. 도구 이름은 CC의 8종에 `roster_` prefix를 붙인 것(`roster_register`·`roster_send_message`·`roster_send_room`·`roster_list_peers`·`roster_set_groups`·`roster_list_groups`·`roster_set_meta`·`roster_unregister`) — 의미는 [plugin §2](plugin.md)와 같다. 도구 실행 컨텍스트의 sessionID로 호출한 세션의 UUID를 찾아 발신한다.
- **인바운드** — 세션별 SSE 연결이 받은 이벤트를 `<channel>` 태그 텍스트로 만들어 `client.session.promptAsync`로 그 세션에 사용자 메시지로 주입한다 — 수신 세션이 연결에 묶여 있어 라우팅 판단이 없다. 채널 규약 지시문(skill 지시 포함 — CC와 같은 프롬프트 수준)은 `roster_register` 도구 결과에 실려 그 세션의 컨텍스트에 남는다.
- **연결 끊김** — 그 세션에 끊김 통보를 주입해 모델이 사용자에게 알리게 한다(CC와 동일한 흐름). `roster_register` 재실행 시 보관된 UUID로 복귀를 시도하며, 재등록 여부·시점이 클라이언트 자율인 것도 CC와 같다.

## 2. 사용

```jsonc
// 대상 프로젝트의 opencode.json (또는 ~/.config/opencode/opencode.json)
{
  "plugin": ["<agent-roster 경로>/plugin-opencode/roster.ts"]
}
```

```bash
export ROSTER_BROKER_URL=http://localhost:3000
export ROSTER_BROKER_TOKEN=<웹 "내 에이전트"에서 발급한 토큰>
opencode
```

세션에서 `roster_register` 실행을 지시하면 등록된다 — CC와 같은 수동 등록이고, 탭(세션)마다 따로 한다. 모델은 도구 호출이 되는 것이어야 한다(등록·발신이 전부 도구 경로).

플러그인 파일은 레포의 `client-core/`(와이어·API 공용 모듈)와 루트 `node_modules`를 상대경로로 참조하므로, 레포 밖으로 복사하면 동작하지 않는다 — 경로 참조로 쓴다.
