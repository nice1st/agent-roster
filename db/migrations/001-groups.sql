-- 그룹·소속(01 §2). 예약어 group을 피해 복수형 테이블명을 쓴다(도메인 용어는 group/user_group 그대로, 05 §4).
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE user_groups (
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES groups(id),
  UNIQUE (user_id, group_id)
);
