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

export function fanoutRoomStart(
  deps: RoomFanoutDeps,
  room: { id: string; name: string; context?: string },
  participants: { uuid: string; alias?: string; persona?: string }[],
): void {
  const sentAt = new Date().toISOString();
  const roster: RoomParticipantRef[] = participants.map((p) => ({ uuid: p.uuid, alias: p.alias }));

  for (const participant of participants) {
    const entry = deps.registry.get(participant.uuid);
    if (entry === undefined) continue;

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

export function fanoutTargets(participantUuids: string[], subscriberUuids: Iterable<string>): Set<string> {
  const targets = new Set(participantUuids);
  for (const uuid of subscriberUuids) targets.add(uuid);
  return targets;
}

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
      subscriptions?.remove(roomId, uuid);
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
  markEnded(roomId: string): void;
  listParticipantUuids(roomId: string): string[];
}

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

  for (const uuid of targets) {
    deps.subscriptions.remove(room.id, uuid);
  }
}

export interface RoomExpirySweepDeps extends EndRoomDeps {
  listExpiredRooms(nowIso: string): { id: string; name: string }[];
}

export function sweepExpiredRooms(deps: RoomExpirySweepDeps): void {
  const nowIso = new Date().toISOString();
  for (const room of deps.listExpiredRooms(nowIso)) {
    endRoom(deps, room);
  }
}
