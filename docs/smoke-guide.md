# 스모크 가이드

> 실물 CC 연결·Google OAuth 플로우는 자동화에서 제외한 수동 검증 영역이다([architecture §4](architecture.md) 테스트 결정). 이 문서는 그 수동 스모크를 처음부터 끝까지 돌리는 절차다 — 순서대로 실행하면 되고, 마지막 절이 롤백이다.

## 0. 준비물

- Bun 1.3.11
- Google OAuth 클라이언트 — Cloud Console → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID(유형: 웹 애플리케이션)
  - 승인된 리디렉션 URI: `http://localhost:3000/api/auth/callback/google`

## 1. 브로커 기동

```bash
# 인증 env 3개 — 하나라도 없으면 부팅 시 즉시 실패한다
export GOOGLE_CLIENT_ID="..."                        # OAuth 클라이언트 ID
export GOOGLE_CLIENT_SECRET="..."                    # OAuth 클라이언트 시크릿
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"  # 세션·서명 시크릿 — 재기동 간 유지할 것. 바꾸면 발급된 토큰·세션 전부 무효

# DB 준비 — 기본 경로 ./data/broker.db (BROKER_DB_PATH로 변경 가능). 두 커맨드 모두 멱등
bun run auth:migrate                       # Better Auth 테이블 생성
bun scripts/bootstrap-admin.ts you@example.com   # 첫 admin 사용자 생성 — 자기 Google 계정 메일로

bun src/index.ts                           # http://localhost:3000 에서 대기
```

## 2. 웹 로그인·토큰 발급

1. `http://localhost:3000` → Google 로그인 — 부트스트랩한 메일의 계정으로. (다른 계정으로 시도하면 거부되는 것도 확인 포인트 — 초대 게이트)
2. 관리자 화면에서 그룹을 만들고 자기에게 부여 — 발견(peers) 판정 확인용.
3. "내 에이전트" → 토큰 생성 → 복사.

## 3. 플러그인 설치 (최초 1회)

```bash
# 로컬 레포를 마켓플레이스로 등록하고 플러그인 설치
claude plugin marketplace add ~/workspace/github/agent-roster
claude plugin install roster@agent-roster

claude mcp list        # plugin:roster:roster ✔ Connected 확인
```

로컬 마켓플레이스는 레포 경로를 직접 실행하므로, 플러그인 코드를 수정하면 재설치 없이 `cd plugin && bun run build` 후 새 CC 세션부터 반영된다.

## 4. CC 세션 연결

```bash
# 플러그인이 읽는 env 2개 — CC를 띄우는 셸에서 export
export ROSTER_BROKER_URL="http://localhost:3000"
export ROSTER_BROKER_TOKEN="..."           # 2에서 복사한 토큰
claude
```

세션에서 "register 도구 실행해줘" → `registered: <uuid>` 응답이면 연결 성공.

## 5. 확인 시나리오

| # | 시나리오 | 기대 |
|---|---------|------|
| 1 | register 후 웹 "내 에이전트" | 세션이 목록에 보인다 |
| 2 | CC 세션 2개 register → 한쪽에서 `list_peers` | 상대 uuid·alias가 보인다(같은 그룹 노출) |
| 3 | `send_message(to_id, ...)` | 상대 세션에 `<channel from_id=...>` 주입, 발신측은 Delivered |
| 4 | 웹 1:1 대화에서 에이전트에게 발신 | 에이전트가 수신하고, 답장이 웹에 표시된다 |
| 5 | 웹에서 room 생성 → 두 에이전트 초대 → 시작 | 두 세션에 room intro(`<channel room_id=...>`) 주입 |
| 6 | 에이전트가 `send_room` 발언 | 전원 팬아웃 + 웹 관전 표시, 종료 후에도 기록 조회 가능 |
| 7 | room 종료(버튼 또는 타이머 만료) | 종료 통보가 가고, 이후 `send_room`은 거부된다 |
| 8 | 브로커 재시작 → 세션에서 register 재실행 | 연결 끊김 알림 후, 같은 UUID로 복귀한다 |

## 6. 롤백

```bash
claude plugin uninstall roster@agent-roster      # 플러그인 제거
claude plugin marketplace remove agent-roster    # 마켓플레이스 등록 해제
unset ROSTER_BROKER_URL ROSTER_BROKER_TOKEN
rm -rf data/                                     # 로컬 DB 삭제 — 계정·그룹·room 기록이 사라진다
```
