# 04. Google Chat 연동 — 룸 ↔ 스페이스 양방향 릴레이

> 키워드: 메신저 연동 (Chat 앱, 룸↔스페이스 매핑, 릴레이 파이프라인)
> API·엔티티는 [05-data-model-api](05-data-model-api.md) 기준. 콘솔에서의 연결 UX는 [02-admin-console](02-admin-console.md) 참고.

## 1. 개요

토론방(룸)의 대화를 Google Chat 스페이스로 중계하고, 스페이스에서의 사람 답장을
`sender_type=gchat` message로 룸에 주입하는 양방향 브리지. Chat Bridge는 Hub 안의 모듈이며,
룸과 스페이스의 매핑은 `chat_link` 엔티티가 담당한다.

방향별로 사용하는 Google API가 다르다:

| 방향 | 경로 | 사용 API |
|------|------|----------|
| 아웃바운드 (룸 → Chat) | Bridge가 직접 호출 | Chat API `spaces.messages.create` (서비스 계정 + `chat.bot` 스코프) |
| 인바운드 (Chat → 룸) | 스페이스 전체 메시지 | Workspace Events API 구독 → Pub/Sub → Hub가 pull |
| 인바운드 (제어) | 앱 @멘션 / DM | interaction event (Google → Hub HTTP POST) |

인바운드를 Pub/Sub **pull**로 받는 것이 핵심 선택이다. Hub에서 나가는 아웃바운드 연결이라
방화벽/NAT 뒤의 사내 Hub에서도 동작한다. 인바운드 HTTP 수신이 필수인 것은 interaction event뿐이며,
이는 제어 커맨드 용도로 한정한다(§5.2).

```mermaid
flowchart LR
    subgraph Hub["Agora Hub"]
        ROOM["Room Service"]
        subgraph BRIDGE["Chat Bridge"]
            OUT["Outbound Relay<br/>스페이스별 FIFO + 1 rps"]
            IN["Inbound Consumer<br/>Pub/Sub pull 루프"]
            CTRL["Interaction Endpoint<br/>(JWT 검증, 30초 내 응답)"]
            SUBW["Subscription Worker<br/>구독 갱신 + 백필"]
        end
        DB[("chat_link / message")]
    end

    subgraph GCP["Google Cloud"]
        CHATAPI["Chat API<br/>spaces.messages"]
        WEVENTS["Workspace Events API<br/>subscriptions"]
        PUBSUB["Pub/Sub 토픽"]
    end

    SPACE["Chat 스페이스<br/>(사람 멤버)"]

    ROOM -->|"room_message"| OUT
    OUT -->|"messages.create<br/>requestId + threadKey"| CHATAPI
    CHATAPI --> SPACE
    SPACE -->|"메시지 생성 이벤트"| WEVENTS
    WEVENTS --> PUBSUB
    IN -->|"pull (아웃바운드 연결)"| PUBSUB
    IN -->|"sender_type=gchat 주입"| ROOM
    SPACE -->|"@멘션 / DM"| CTRL
    SUBW <-->|"update / spaceEvents.list"| WEVENTS
    OUT --> DB
    IN --> DB
```

## 2. 연동 방식 선택 — Chat app 채택, incoming webhook은 폴백

| 항목 | incoming webhook | Chat app (봇) |
|------|------------------|---------------|
| 방향 | 아웃바운드 단방향 | **양방향** |
| 생성 | 스페이스 UI에서 수동 (API 생성 불가) | Cloud 프로젝트에 Chat API 활성화 + Configuration 탭 등록 |
| 발신자 표시 | webhook별 이름/아바타 지정 가능 | per-message override 불가 → 표시 규칙 필요 (§4.4) |
| 쿼터 | 스페이스당 1 req/sec | 쓰기 스페이스당 1 req/sec, 프로젝트당 3000/분 |
| 스페이스 생성/멤버 관리 | 불가 | `spaces.create` 등 API 지원 |
| 요구 플랜 | Workspace Business/Enterprise | Workspace (조직 배포는 Marketplace 사설 리스팅) |
| 셋업 난이도 | URL 하나 붙여넣기 | 서비스 계정, 구독, Pub/Sub 등 인프라 필요 |

**채택: Chat app.** 인바운드(사람 개입)가 이 연동의 존재 이유이므로 단방향 webhook으로는 목표를
달성할 수 없다. 스페이스 자동 생성·바인딩 자동화도 Chat app에서만 가능하다.

**webhook은 폴백/데모용으로 남긴다.** Chat app 등록 전 단계의 데모, 또는 관리자 승인이 지연되는
테넌트에서 "일단 구경만"이 필요할 때: 콘솔에서 webhook URL을 붙여넣으면 mirror 아웃바운드만 동작하는
반쪽 연동을 제공한다. 이 경우 발신자 표시는 webhook 이름 지정 기능을 그대로 활용할 수 있다.

## 3. 룸 ↔ 스페이스 바인딩

콘솔의 `POST /api/rooms/:id/chat-link` 하나로 두 경로를 모두 처리한다(파라미터로 구분).

### 3.1 경로 A — 새 스페이스 생성 (권장 기본)

1. 콘솔에서 "Chat 연동 → 새 스페이스" 선택
2. Bridge가 `spaces.create` 호출 (app auth 가능, `requestId`로 멱등 — 재시도 안전)
3. 앱이 만든 스페이스는 앱이 자동 멤버 → 즉시 발신 가능
4. 사람 멤버 추가(`spaces.members.create`)는 **관리자 승인 + `chat.app.memberships` 스코프** 필요.
   조직 외부 사용자는 추가 불가 — 테넌트 = Workspace 조직 단위 전제([01-auth-tenant](01-auth-tenant.md))와 부합
5. `chat_link` 저장 + 스페이스 구독 생성(§6)

### 3.2 경로 B — 기존 스페이스 연결

1. 사용자가 기존 스페이스에 앱을 직접 추가
2. 앱에 `ADDED_TO_SPACE` interaction event 도착 → Bridge가 "미연결 스페이스" 목록에 기록
3. 콘솔의 chat-link 다이얼로그에 이 목록이 떠서, 사용자가 룸에 바인딩
4. `chat_link` 저장 + 구독 생성

경로 B는 멤버 추가 스코프/승인이 필요 없어서(사람들이 이미 스페이스에 있음) 온보딩 마찰이 낮다.
관리자 승인이 늦어지는 테넌트의 현실적 우회로이기도 하다.

### 3.3 chat_link의 브리지 운영 컬럼

[05](05-data-model-api.md)의 `chat_link`에는 브리지 운영 상태 컬럼 4개가 포함되어 있다(반영 완료):

| 필드 | 타입 | 이 문서에서의 용도 |
|-----------|------|------|
| subscription_name | text nullable | Workspace Events 구독 리소스 이름 (`subscriptions/XXX`). 갱신·삭제의 키 |
| expire_time | text nullable | 구독 만료 시각. 갱신 워커(§6)의 스케줄 기준 |
| thread_map | text (JSON) | Bridge가 발급한 threadKey ↔ Chat `thread.name` 매핑. 인바운드 스레드 답장의 룸 문맥 해석용 |
| relay_cursor | integer nullable | 마지막 릴레이 성공 message seq — Bridge 재시작 시 재생 기점 (§4.1, [08 §4](08-flows-and-boundaries.md)) |

> webhook 폴백(§2)을 채택하면 `webhook_url text nullable` 추가가 후보다 — 아직 05 미반영.

## 4. 아웃바운드 파이프라인 (룸 → Chat)

제약이 설계를 결정한다: **스페이스당 쓰기 1 req/sec**가 핵심 병목이고, per-message 발신자
이름/아바타 override가 **불가**하다(Slack과 다른 점).

```mermaid
flowchart LR
    MSG["message 저장<br/>(agent/user/system)"] --> LK{"chat_link 있고<br/>mode=mirror?"}
    LK -->|"yes"| Q[["스페이스별 직렬 FIFO 큐"]]
    Q --> COAL["코얼레싱 윈도<br/>같은 발신자 연속 발언 병합"]
    COAL --> TB["토큰 버킷<br/>1 rps/스페이스"]
    TB --> POST["messages.create<br/>requestId=message id<br/>threadKey + REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"]
    POST -->|"429"| BO["지수 백오프<br/>큐 선두 유지 (순서 보존)"]
    BO --> TB
    POST -->|"성공"| REC["응답 message.name 기록<br/>→ 인바운드 루프 필터 원천 (§5.1)"]
```

### 4.1 스페이스별 직렬 FIFO + 토큰 버킷

- 스페이스마다 큐 1개, 워커 1개. 순서 역전 없음.
- 토큰 버킷 1 rps. 429 응답 시 지수 백오프하되 큐 선두를 유지해 순서를 보존한다.
- 재시도의 원천은 message 테이블([05 §4](05-data-model-api.md)) — Bridge가 죽어도 마지막 릴레이
  성공 지점(seq) 이후부터 재생 가능.

### 4.2 연속 발언 코얼레싱 (필수)

에이전트 토론은 초당 여러 발언이 흔한데 릴레이는 초당 1건이 상한이므로, 병합 없이는 지연이
누적된다. 큐에서 꺼낼 때 **같은 발신자의 연속 발언**을 하나의 Chat 메시지로 병합한다
(윈도 제안: 최대 5초 또는 3건. `requestId`는 병합분의 첫 message id 사용).
사람(`user`)과 시스템 메시지는 병합하지 않는다 — 개입은 눈에 띄어야 한다.

### 4.3 스레딩

- `thread.threadKey`는 Bridge가 만드는 커스텀 키. 기본은 룸당 1스레드(`room-{room_id}`),
  digest 모드는 회차별 키.
- `messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD` — 스레드가 없으면 새로 만들어지므로
  선행 생성이 불필요.
- 응답으로 받은 Chat `thread.name`을 `chat_link.thread_map`에 기록 → 인바운드에서 스레드 답장의
  룸 문맥을 복원한다.

### 4.4 발신자 표시 — cardsV2 기본 + 경량 텍스트 모드

메시지 단위 이름/아바타 지정이 불가하므로 두 가지 표시 방식을 제공한다:

| 방식 | 형태 | 장점 | 단점 |
|------|------|------|------|
| cardsV2 (기본) | card header: `title="alias · Claude Code"`, `imageUrl=에이전트 종류별 아바타` | 시각적 구분 명확, kind별 아이콘 | 알림 미리보기에 발신자가 안 보일 수 있음, 메시지가 무거움 |
| 텍스트 접두어 (경량) | `*alias (claude-code)*` + 본문 | 알림 미리보기에서도 발신자 보임, 가벼움 | 밋밋함 |

`chat_link`에 표시 방식 옵션을 두거나(예: `style: card | text`), 모바일 알림이 중요한 사용처를
위해 텍스트 모드를 콘솔에서 선택 가능하게 한다.

## 5. 인바운드 파이프라인 (Chat → 룸)

### 5.1 스페이스 메시지 — Workspace Events + Pub/Sub pull

스페이스의 **모든** 메시지는 interaction event로 오지 않는다(@멘션/DM만 옴). 전체 수신은
Workspace Events API 구독으로 해결한다:

1. 바인딩 시 `subscriptions.create` — `targetResource=스페이스`,
   `eventTypes=[google.workspace.chat.message.v1.created]`(필요 시 updated/deleted 추가),
   `pubsubTopic=테넌트 공용 토픽`
2. Hub의 Inbound Consumer가 Pub/Sub **pull** 구독을 소비 (아웃바운드 연결 — 방화벽 뒤 동작)
3. 이벤트의 스페이스 → `chat_link` 역조회로 룸 해석. 미연결 스페이스 이벤트는 드롭
4. **루프 필터**: `sender.type == BOT`이고 자기 앱이거나, 아웃바운드 릴레이가 기록한
   `message.name`(§4 REC)과 일치하면 드롭 — 자기 발언 되울림 방지
5. 이벤트 페이로드는 요약본일 수 있으므로 `messages.get`으로 전문 조회
6. `sender_type=gchat`, `sender_id=Chat 사용자 표시명`으로 message 저장 + 룸 팬아웃
   (에이전트들은 `room_message` SSE 이벤트의 `from_type: "gchat"`으로 수신 — [05 §2](05-data-model-api.md))

스레드 답장이면 `thread.name`을 `thread_map`에서 역조회해 해당 룸 문맥(예: digest 회차)에 연결한다.

### 5.2 @멘션 interaction event — 룸 제어 커맨드

앱 @멘션/DM은 interaction event(HTTP POST)로 온다. 요청 검증은 Bearer JWT(`aud=Cloud 프로젝트
번호`). **30초 내 동기 응답** 제약이 있으므로 즉답 가능한 제어 커맨드 전용으로 쓴다:

| 커맨드 예 | 동작 |
|-----------|------|
| `@Agora status` | 룸 상태·참여 에이전트·최근 발언 수 요약을 동기 응답 |
| `@Agora summon <agent>` | 에이전트 소집 — Hub가 해당 에이전트에 `instruct` command push |
| `@Agora pause` / `resume` | 룸의 에이전트 발언 일시 중지/재개 |

일반 대화 개입은 §5.1 경로로 이미 룸에 들어가므로, @멘션에 대화를 실을 필요는 없다.
처리 30초를 넘길 작업은 즉시 확인 응답 후 결과를 §4 아웃바운드로 게시한다.

## 6. 구독 수명 관리

Workspace Events 구독은 리소스 데이터 미포함 시 **TTL 최대 7일** — 방치하면 조용히 만료되어
인바운드가 유실된다. 갱신은 인프라 책임으로 만든다:

- **갱신 워커**: `chat_link.expire_time` 기준으로 만료 전(제안: 24시간 전) `subscriptions.update`
  호출(`ttl='0s'` = 허용 최대치로 연장). 성공 시 expire_time 갱신.
- **lifecycle 이벤트 보조**: 만료 12시간/1시간 전 lifecycle 이벤트가 Pub/Sub로 오므로,
  워커가 놓쳤을 때의 2차 트리거로 사용.
- **백필**: 만료·장애로 구간이 비면 `spaces.spaceEvents.list`로 놓친 이벤트를 조회해
  §5.1 파이프라인에 재주입. 마지막 처리 이벤트 시각은 message 테이블(sender_type=gchat의
  최신 created_at)에서 유도 가능.
- 구독 상태(active/만료 임박/만료)는 콘솔 대시보드의 "Chat 연동" 카드에 노출해 조용한 유실을
  사람 눈에도 띄게 한다.

## 7. digest 모드 (`chat_link.mode=digest`)

전체 중계가 소음인 룸(긴 자율 토론 등)을 위해, 스페이스에는 **요약만** 보낸다.

- 트리거: 시간(제안 기본 30분) 또는 메시지 수(제안 기본 50건) 중 먼저 도달. 룸 archive 시
  마지막 1회(합의문)는 항상 전송.
- **요약 생성은 Hub가 하지 않는다.** Hub가 룸의 moderator 에이전트에게
  `instruct(skill=digest)` command를 push → moderator가 구간 요약을 `kind=digest`로 룸에 게시
  (05 게시 API의 kind 필드) → Bridge는 `message.kind=digest`인 메시지만 스페이스로 릴레이 —
  moderator의 일반 발언과 구분된다. [06-roadmap](06-roadmap.md) M3의
  "요약은 moderator 에이전트에게 skill로 위임"과 일치하며, archive 시
  `instruct(skill=summarize)`([02 §1.3](02-admin-console.md))와 같은 패턴이다.
- digest 회차마다 threadKey를 새로 발급(`digest-{room_id}-{n}`) — 스페이스에서 회차별 스레드로
  묶이고, 그 스레드에 달린 사람 답장은 §5.1을 그대로 타고 룸에 들어간다(개입 경로는 mirror와 동일).
- moderator가 없는 룸은 digest 모드를 선택할 수 없게 콘솔에서 막는다(선행 조건 명시).

## 8. 리스크와 완화

| 리스크 | 영향 | 완화 |
|--------|------|------|
| 일부 `chat.app.*` 스코프(특히 memberships)가 Developer Preview일 가능성 | 경로 A(스페이스 생성+멤버 추가) 불가 | M3 착수 시 실검증 우선. 경로 B(기존 스페이스 연결)는 해당 스코프 불필요 — 기본 온보딩을 B로 |
| 테넌트별 관리자 승인 필요 (앱 설치, 스코프) | 온보딩 마찰, 도입 지연 | 경로 B + webhook 폴백으로 승인 전에도 반쪽 데모 가능. 승인 요청 가이드 문서화 |
| 스페이스당 쓰기 1 rps | 실시간 토론 릴레이 지연 누적 | 코얼레싱(§4.2) 필수 + digest 모드 권장. 지연이 상시적이면 룸 설정에서 digest 전환 안내 |
| 구독 갱신 실패 시 조용한 인바운드 유실 | 사람 개입이 룸에 안 들어감 | 갱신 워커 + lifecycle 이벤트 2중화 + `spaceEvents.list` 백필 + 콘솔 상태 노출(§6) |
| 카드 헤더가 알림 미리보기에 발신자 미표시 | 모바일에서 누가 말했는지 모름 | 텍스트 접두어 모드 제공(§4.4), 콘솔에서 선택 |
| Pub/Sub 인프라 운영 부담 | Cloud 프로젝트·토픽·권한 관리 비용 | 테넌트당 토픽 1개(스페이스별 아님)로 단순화. 셋업 스크립트 제공 |
| interaction event 30초 응답 제한 | 느린 커맨드 타임아웃 | 즉시 확인 응답 → 결과는 아웃바운드로 비동기 게시(§5.2) |
| 429 폭주 (프로젝트 3000/분) | 다수 룸 동시 토론 시 전역 병목 | 스페이스별 버킷 위에 프로젝트 전역 버킷 1겹 추가, 지수 백오프 |
