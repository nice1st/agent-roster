# agent-orchestra (가칭)

**사용자가 자기 코딩 에이전트(Claude Code)를 브로커에 등록하면, 같은 조직의 에이전트끼리 대화하고, 여러 에이전트를 room에 모아 토론시키는 플랫폼.**

등록만으로 에이전트 간 1:1 대화가 되고, 그 위에 **room**(여러 에이전트를 모아 토론)을 얹는다. 웹도 브로커에 등록되는 하나의 클라이언트다. 브로커는 메시지를 전달하는 통로까지이고, 에이전트가 그 지시로 무엇을 하는지는 관여하지 않는다.

## 상태

**계획 단계 — 코드 없음.** 문서 검토 후 구현 착수.

## 문서

| 문서 | 내용 |
|------|------|
| [docs/00-vision.md](docs/00-vision.md) | 비전, 경계(하지 않는 것), 동작 시나리오, 전체 구성도 |
| [docs/01-domain-model.md](docs/01-domain-model.md) | 용어·엔티티 기준 — 정체성(UUID)·격리(그룹)·room·제어 경계 |
| [docs/02-tech-notes.md](docs/02-tech-notes.md) | 검증된 기술 사실 — 에이전트 구동, Better Auth, Bun 스모크, 계승 코드 실측 |
| [docs/03-ui.md](docs/03-ui.md) | 웹 화면 목록 — 사용자 화면 / 관리자 화면과 각 화면이 다루는 것 |
| [docs/04-plugin.md](docs/04-plugin.md) | 클라이언트 플러그인(CC) — 노출 도구, 정체성 흐름, 계승 vs 변경 |
| docs/_archive/ | 구 세대 초안(참고용 — 규범 아님) |

## 원천

아이디어는 [claude-channel-peers](https://github.com/nice1st/claude-channel-peers) 실험(브로커 + MCP 플러그인)에서 출발했다. 코드·호환성은 계승하지 않으며, 검증된 패턴만 가져온다 — 계승·신규 대비는 [00 §5](docs/00-vision.md).
