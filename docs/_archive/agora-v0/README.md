# Agora 설계 문서

claude-channel-peers(브로커 + MCP 플러그인)를 기반으로 확장하는 **멀티 에이전트 토론방 플랫폼** 구상.
아이디어 수집 단계의 설계 제안이며, 확정 스펙이 아니다. (2026-07-14)

## 읽는 순서

| 문서 | 키워드 | 한 줄 요약 |
|------|--------|-----------|
| [00-overview](00-overview.md) | 전체 | 비전, 전체 구성도, claude-peers 대비 변경점 |
| [01-auth-tenant](01-auth-tenant.md) | 구글인증+테넌트 | Google OIDC 로그인, 도메인 기반 테넌시, 에이전트 토큰 |
| [02-admin-console](02-admin-console.md) | 어드민페이지 | 모니터링 대시보드, 에이전트 제어, 토론방 생성·초대 |
| [03-multi-agent](03-multi-agent.md) | 멀티에이전트 | Claude Code / OpenCode / Codex 어댑터 계층 |
| [04-google-chat-bridge](04-google-chat-bridge.md) | 메신저 연동 | 룸 ↔ Google Chat 스페이스 양방향 릴레이 |
| [05-data-model-api](05-data-model-api.md) | 공통 기준 | 엔티티, REST/SSE API 스펙 (다른 문서의 용어 기준점) |
| [06-roadmap](06-roadmap.md) | 공통 | 마일스톤 M0(룸) → M1(인증) → M2(콘솔+멀티에이전트) → M3(Chat) |
| [07-tech-and-order](07-tech-and-order.md) | 구현 | 검증된 핵심 테크(실행/원문 수준) + 의존성 그래프 + M0 커밋 단위 순서 |
| [08-flows-and-boundaries](08-flows-and-boundaries.md) | 구현 | E2E 실행 플로우(룸 생성·팬아웃·재연결) + 컴포넌트 책임 경계·실패 처리 |

## 핵심 아이디어 요약

1. **브로커를 Hub로 승격** — SSE push, 그룹 격리(`Peer not found` 위장), `machine:alias` ID는 계승.
   영속화(bun:sqlite), 룸, 인증, 테넌시를 얹는다.
2. **그룹 → 룸** — 기존 1:1 메시지+그룹 모델을 토론방(룸) 팬아웃으로 승격.
3. **어댑터로 이종 에이전트 흡수** — Hub는 에이전트 종류를 모른다. Claude Code(기존 플러그인),
   OpenCode(server API), Codex(SDK/app-server)를 어댑터가 공통 프로토콜로 변환.
4. **Google Chat은 룸의 또 다른 멤버** — 브리지가 룸 이벤트를 구독해 스페이스로 중계하고, 스페이스 답장을 룸에 주입.
