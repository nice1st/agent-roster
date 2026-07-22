# 06. 로드맵

> 원칙: 각 마일스톤은 그 자체로 배포·시연 가능해야 한다. 기존 claude-peers 사용자는 어느 시점에도 깨지지 않는다.

## M0 — 룸이 있는 브로커 (기반 다지기) ✅ 완료 (2026-07-16, 2.1.0)

목표: 인증 없이, 현재 브로커에 **영속화 + 룸**을 얹는다. 어드민 없이 API로만 조작.

- [x] bun:sqlite 도입, repository 모듈 분리 (agent/room/message)
- [x] Room Service: 룸 CRUD, 멤버십, 룸 메시지 팬아웃 (`room_message` SSE 이벤트)
- [x] 기존 1:1 `send_message`는 "같은 룸 공유" 규칙으로 전환 (그룹 → 룸 흡수)
- [x] channel plugin에 room-tools 도구 추가: `list_rooms`, `post_to_room`, `read_room_history` (03의 도구 계약과 동일 이름)
- [x] `set_groups` 호환: 그룹명과 동명의 open 룸(에이전트 자가 참여 가능한 시스템 룸)을 자동 생성·참여로 매핑하고 deprecated 선언 — 기존 사용자 무중단 원칙
- [x] 메시지 히스토리 API (`GET /api/rooms/:id/messages`)

시연: curl로 룸 만들고 Claude Code 2대 초대 → 토론 → 히스토리 조회. (curl + MCP stdio 2세션 스모크로 검증 완료)

M0 이행 중 확정된 사항: 1:1 `message` 이벤트에는 SSE `id:` 라인을 붙이지 않는다 — 구버전(2.0.x) 파서는 블록 전체가 `data:`로 시작해야 처리하므로 id 라인이 있으면 메시지를 통째로 버린다. 재생 커서(07 §5 커밋 9)는 M2에서 플러그인 업데이트와 함께 도입.

## M1 — 인증 + 테넌트

목표: Google OIDC 로그인과 에이전트 토큰. 이때부터 외부 배포 가능.

- [ ] 인증 라이브러리 채택: Better Auth(organization + api-key 플러그인) 우선 검토 — 근거는 [01](01-auth-tenant.md)
- [ ] Google OIDC (Authorization Code + PKCE), 쿠키 세션
- [ ] hd 클레임 기반 테넌트 자동 생성/매핑, 첫 사용자 = admin (허용 도메인 화이트리스트로 선점 방지)
- [ ] 에이전트 토큰 발급/폐기, `/agent/*` Bearer 검증
- [ ] `CLAUDE_PEERS_AUTH=off|soft|required` 단계 전환 운영 ([08 플로우 E](08-flows-and-boundaries.md) — soft 관측 → required, 기존 연결 유예)
- [ ] 전 리소스 테넌트 스코프 적용 (조회·전송 격리)
- [ ] channel plugin: `CLAUDE_PEERS_TOKEN` 환경변수 지원

시연: 두 구글 계정(다른 도메인)으로 로그인 → 서로의 에이전트·룸이 안 보임.

## M2 — 어드민 콘솔 + 멀티에이전트

목표: 웹 UI에서 전 과정 조작. Claude Code 외 에이전트 1종 이상.

- [ ] 어드민 콘솔 SPA: 대시보드(SSE 실시간), 에이전트 목록/제어, 룸 생성·초대·타임라인
- [ ] `POST /api/agents/:id/command` (ping / instruct / disconnect)
- [ ] Adapter 프로토콜 확정 + OpenCode 어댑터 (server API 기반)
- [ ] Codex 어댑터 (`@openai/codex-sdk` 기반, `codex exec --json` 폴백 — 03 권장 순서)
- [ ] 룸 mode: `round-robin` — 사회자 지정(`invite`의 moderator_id) + 다음 발언자 지정 API(`/agent/rooms/:id/next-speaker`)

시연: 콘솔에서 룸 생성 → Claude Code + OpenCode + Codex 초대 → 토론 관전·개입.

## M3 — Google Chat 연동

목표: 토론을 Chat에서 받아보고 답장으로 개입.

- [ ] Chat 앱 등록 + 서비스 계정 구성 (chat.bot 스코프, 관리자 승인 스코프는 실검증 필요)
- [ ] `chat_link`: 룸 ↔ 스페이스 매핑, mirror 모드 릴레이 (스페이스당 초당 1건 쓰기 제한 → 스페이스별 직렬 큐 + 연속 발언 병합)
- [ ] Chat → 룸 역방향: Workspace Events 구독 + Pub/Sub pull → `sender_type=gchat`으로 룸 주입 (루프 필터 포함)
- [ ] 구독 갱신 워커 (TTL 최대 7일 — 만료 추적·재갱신·spaceEvents 백필)
- [ ] digest 모드: 토론 요약만 주기 전송 (요약은 moderator 에이전트에게 skill로 위임)

시연: 휴대폰 Google Chat에서 에이전트 토론을 보다가 답장 → 에이전트들이 반영.

## 그 이후 (아이디어 주차장)

- 토론 결과물 자동 정리 (합의문/결정 기록을 룸 아카이브 시 생성)
- 에이전트 페르소나 프리셋 (비판자, 중재자, 요약자)
- Slack/Discord 브리지 (Chat Bridge 인터페이스 재사용)
- 룸 템플릿 (코드리뷰 토론, 설계 토론, 장애 회고)
- 비용/토큰 사용량 대시보드
