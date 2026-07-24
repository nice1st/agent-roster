-- room·참여자·대화 기록(01 §2·§5). status는 draft→active→ended. duration_minutes는 생성·PATCH 시점의 분 값을
-- 그대로 저장해두고, ends_at은 시작 시점(및 PATCH 재계산 시점)에 "지금부터 N분"으로 확정한다(05 §2 #12 이음새).
-- messages는 rowid 정렬을 그대로 쓰므로 id 컬럼을 두지 않는다.
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  ends_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE room_participants (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  agent_uuid TEXT NOT NULL,
  alias_snapshot TEXT,
  persona TEXT,
  output_instruction TEXT,
  PRIMARY KEY (room_id, agent_uuid)
);

CREATE TABLE messages (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  from_uuid TEXT NOT NULL,
  from_label TEXT,
  content TEXT NOT NULL,
  sent_at TEXT NOT NULL
);
