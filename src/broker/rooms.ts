// room 팬아웃 — 대상 = DB 참여자 uuid + 런타임 구독자 집합(슬라이스 13, 관전). registry로 push, 실패·오프라인은
// 건너뛴다(00 §2 유실 정책과 일관). store 직접 import 금지 — 필요한 조회는 deps로 주입한다(05 §2 #12 이음새).

import type { BrokerEvent } from "../shared/protocol";
import type { Registry } from "./registry";
import { sseFrame } from "./sse";

export interface RoomParticipantRef {
  uuid: string;
  alias?: string;
}

export interface RoomFanoutDeps {
  registry: Registry;
}

/** room-start를 팬아웃한다 — 참여자별로 자기 자신의 persona가 담긴 개별 프레임을 만든다(01 §5). */
export function fanoutRoomStart(
  deps: RoomFanoutDeps,
  room: { id: string; name: string; context?: string },
  participants: { uuid: string; alias?: string; persona?: string }[],
): void {
  const sentAt = new Date().toISOString();
  const roster: RoomParticipantRef[] = participants.map((p) => ({ uuid: p.uuid, alias: p.alias }));

  for (const participant of participants) {
    const entry = deps.registry.get(participant.uuid);
    if (entry === undefined) continue; // 오프라인 참여자는 조용히 건너뜀(00 §2)

    const event: BrokerEvent = {
      type: "room-start",
      room: room.id,
      name: room.name,
      ...(room.context !== undefined ? { context: room.context } : {}),
      ...(participant.persona !== undefined ? { persona: participant.persona } : {}),
      participants: roster,
      sent_at: sentAt,
    };

    try {
      entry.handle.send(sseFrame(event));
    } catch {
      deps.registry.removeIfCurrent(participant.uuid, entry.handle);
    }
  }
}

/** 팬아웃 대상 uuid 집합 — 참여자(DB) ∪ 구독자(런타임). 슬라이스 13에서 room-message가 사용한다. */
export function fanoutTargets(participantUuids: string[], subscriberUuids: Iterable<string>): Set<string> {
  const targets = new Set(participantUuids);
  for (const uuid of subscriberUuids) targets.add(uuid);
  return targets;
}
