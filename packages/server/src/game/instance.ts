import type { PlayerSnapshot } from "@holodle/shared";

// Discord-Activity instance state. One room per `instanceId`. Pure in-memory:
// this is presence data only; durable user state lives in SQLite.

interface Room {
  instanceId: string;
  players: Map<string, PlayerSnapshot>; // userId -> snapshot
}

const rooms = new Map<string, Room>();

function getOrCreate(instanceId: string): Room {
  let room = rooms.get(instanceId);
  if (!room) {
    room = { instanceId, players: new Map() };
    rooms.set(instanceId, room);
  }
  return room;
}

export function upsertPlayer(instanceId: string, snapshot: PlayerSnapshot): void {
  getOrCreate(instanceId).players.set(snapshot.userId, snapshot);
}

export function updateProgress(
  instanceId: string,
  userId: string,
  guessesUsed: number,
  status: PlayerSnapshot["status"],
): void {
  const room = rooms.get(instanceId);
  const p = room?.players.get(userId);
  if (!p) return;
  p.guessesUsed = guessesUsed;
  p.status = status;
}

export function removePlayer(instanceId: string, userId: string): void {
  const room = rooms.get(instanceId);
  if (!room) return;
  room.players.delete(userId);
  if (room.players.size === 0) rooms.delete(instanceId);
}

export function listPlayers(instanceId: string): PlayerSnapshot[] {
  return Array.from(rooms.get(instanceId)?.players.values() ?? []);
}
