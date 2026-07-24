// room 팬아웃 — 대상 = DB 참여자 uuid + 런타임 구독자 집합(슬라이스 13, 관전). registry로 push, 실패·오프라인은
// 건너뛴다(00 §2 유실 정책과 일관). store 직접 import 금지 — 필요한 조회는 deps로 주입한다(05 §2 #12 이음새).
// endRoom·sweepExpiredRooms는 폭파(05 §2 #14) — 버튼과 만료 스위프가 같은 endRoom을 탄다(05 §4 room 종료 처리).

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

/** 팬아웃 대상 uuid 집합 — 참여자(DB) ∪ 구독자(런타임). room-message가 사용한다. */
export function fanoutTargets(participantUuids: string[], subscriberUuids: Iterable<string>): Set<string> {
  const targets = new Set(participantUuids);
  for (const uuid of subscriberUuids) targets.add(uuid);
  return targets;
}

// 관전 구독 — room UUID → 구독 uuid 집합(런타임, 메모리). 웹 세션이 watch로 추가·제거한다(05 §2 #13).
// 참여자가 아니어도 room-message를 받게 하는 확장 통로 — 웹 관전자는 room_participant가 아니므로 필요하다.
export class RoomSubscriptions {
  private byRoom = new Map<string, Set<string>>();

  add(roomId: string, uuid: string): void {
    let set = this.byRoom.get(roomId);
    if (set === undefined) {
      set = new Set();
      this.byRoom.set(roomId, set);
    }
    set.add(uuid);
  }

  remove(roomId: string, uuid: string): void {
    this.byRoom.get(roomId)?.delete(uuid);
  }

  get(roomId: string): Set<string> {
    return this.byRoom.get(roomId) ?? new Set();
  }
}

/** room-message를 팬아웃한다 — 참여자(DB) ∪ 구독자(런타임) 전원에게 같은 프레임을 보낸다(01 §5 전체 팬아웃). */
export function fanoutRoomMessage(
  deps: RoomFanoutDeps,
  roomId: string,
  message: { from: string; fromLabel?: string; content: string },
  targets: Set<string>,
  subscriptions?: RoomSubscriptions,
): void {
  const sentAt = new Date().toISOString();
  const event: BrokerEvent = {
    type: "room-message",
    room: roomId,
    from: message.from,
    ...(message.fromLabel !== undefined ? { from_label: message.fromLabel } : {}),
    sent_at: sentAt,
    message: message.content,
  };

  for (const uuid of targets) {
    const entry = deps.registry.get(uuid);
    if (entry === undefined) {
      subscriptions?.remove(roomId, uuid); // 레지스트리에서 사라진 구독은 정리한다(05 §2 #13 이음새)
      continue;
    }
    try {
      entry.handle.send(sseFrame(event));
    } catch {
      deps.registry.removeIfCurrent(uuid, entry.handle);
      subscriptions?.remove(roomId, uuid);
    }
  }
}

export interface EndRoomDeps extends RoomFanoutDeps {
  subscriptions: RoomSubscriptions;
  /** status→ended 전환(store 몫) — 브로커는 store를 직접 import하지 않으므로 주입받는다(05 §2 #14 이음새). */
  markEnded(roomId: string): void;
  listParticipantUuids(roomId: string): string[];
}

/**
 * 폭파 함수 — status→ended 전환 + 참여자∪구독자 전원에게 room-end 팬아웃 + 런타임 구독 정리(05 §4 room 종료 처리).
 * 버튼 폭파(POST /api/rooms/:id/end)와 만료 스위프가 같은 이 함수를 탄다.
 */
export function endRoom(deps: EndRoomDeps, room: { id: string; name: string }): void {
  deps.markEnded(room.id);

  const targets = fanoutTargets(deps.listParticipantUuids(room.id), deps.subscriptions.get(room.id));
  const sentAt = new Date().toISOString();
  const event: BrokerEvent = { type: "room-end", room: room.id, name: room.name, sent_at: sentAt };

  for (const uuid of targets) {
    const entry = deps.registry.get(uuid);
    if (entry === undefined) continue;
    try {
      entry.handle.send(sseFrame(event));
    } catch {
      deps.registry.removeIfCurrent(uuid, entry.handle);
    }
  }

  // 런타임 구독 정리 — 이 room은 더 이상 발언을 받지 않으므로 구독 집합 자체를 비운다.
  for (const uuid of targets) {
    deps.subscriptions.remove(room.id, uuid);
  }
}

export interface RoomExpirySweepDeps extends EndRoomDeps {
  /** status='active' AND ends_at <= now인 room 목록(store 몫) — 브로커는 store를 직접 import하지 않는다. */
  listExpiredRooms(nowIso: string): { id: string; name: string }[];
}

/** 만료 스위프 — 하트비트 작업으로 등록된다(05 §4). 만료 room을 찾아 endRoom을 태운다(같은 폭파 함수). */
export function sweepExpiredRooms(deps: RoomExpirySweepDeps): void {
  const nowIso = new Date().toISOString();
  for (const room of deps.listExpiredRooms(nowIso)) {
    endRoom(deps, room);
  }
}
