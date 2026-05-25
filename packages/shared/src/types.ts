// Cross-package types. Both client and server import from "@holodle/shared".
// Keep this file free of runtime code (no Zod, no logic) — types only.

export type Branch = "JP" | "ID" | "EN" | "DEV_IS" | "Stars";

// Cutoffs: ≤150 → Smol, 151–160 → Med, >160 → Tall.
export type HeightBucket = "Smol" | "Med" | "Tall";

export type Month =
  | "January"
  | "February"
  | "March"
  | "April"
  | "May"
  | "June"
  | "July"
  | "August"
  | "September"
  | "October"
  | "November"
  | "December";

export interface Talent {
  id: string;
  name: string;
  avatarUrl: string;
  branch: Branch;
  // Free-form (covers "Gen 0", "GAMERS", "Promise", "Regloss", etc.).
  generation: string;
  debutYear: number;
  archetype: string;
  heightCm: number;
  birthMonth: Month;
  active: boolean;
}

// What the client gets from /api/talents — name + avatar only.
// No attribute data ever leaves the server until the user guesses.
export interface TalentSummary {
  id: string;
  name: string;
  avatarUrl: string;
}

// No "near" / orange state. Every cell is strictly equal-or-wrong; the
// directional columns (debut year, birth month) distinguish the direction
// of a miss via "higher" (target > guess, renders ↑) and "lower" (target <
// guess, renders ↓). Birth month uses linear calendar order (Jan < Dec, no
// wrap).
export type CellState = "equal" | "wrong" | "higher" | "lower";

export interface AttrCell<V> {
  value: V;
  state: CellState;
}

export interface GuessDiff {
  talentId: string;
  // "Gen" column. Echoed so the client can render it without a second lookup.
  generation: AttrCell<string>;
  branch: AttrCell<Branch>;
  debutYear: AttrCell<number>;
  archetype: AttrCell<string>;
  height: AttrCell<HeightBucket>;
  birthMonth: AttrCell<Month>;
}

// Column order for board rows derived from a GuessDiff. Defined as a shared
// constant so both client and server agree on the order of cell states.
export const BOARD_COLUMNS: ReadonlyArray<keyof Omit<GuessDiff, "talentId">> = [
  "generation",
  "branch",
  "debutYear",
  "archetype",
  "height",
  "birthMonth",
];

export function boardRowFromDiff(diff: GuessDiff): CellState[] {
  return BOARD_COLUMNS.map((k) => diff[k].state);
}

export type GameStatus = "playing" | "won" | "lost";

export interface DailyState {
  puzzleId: string; // e.g. "2026-05-18"
  guessesUsed: number;
  history: GuessDiff[];
  status: GameStatus;
  maxGuesses: number; // always 6
}

export interface GuessResponse {
  diff: GuessDiff;
  status: GameStatus;
  guessesUsed: number;
  // On terminal status the server reveals the answer talentId so the client
  // can show the result panel. Only present when status !== "playing".
  answer?: TalentSummary;
}

export interface UserStats {
  streak: number;
  best: number;
  played: number;
  winRate: number; // 0..1
}

// A single guess row reduced to its 6 cell-state colors. Values are stripped
// so we never leak what talent another player guessed — only whether each
// attribute matched. Used by the boards panel so spectators can see every
// player's progress as a colored grid.
export type BoardRow = CellState[];

// Socket.IO event payloads
export interface PlayerSnapshot {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  guessesUsed: number;
  status: GameStatus;
  // Each row is a 6-tuple of CellStates (one per attribute column). Length
  // equals guessesUsed; older snapshots from completed players are loaded
  // from the DB on socket connect. We intentionally do NOT broadcast the
  // full GuessDiff (with talent ids + attribute values) — only cell colors
  // — so spectators can't see what talents other players guessed.
  board: BoardRow[];
}

export interface PlayerProgressEvent {
  userId: string;
  guessesUsed: number;
  status: GameStatus;
  // Full board, not just the new row — keeps the client deterministic in the
  // face of dropped events / reconnects.
  board: BoardRow[];
}

export interface ServerToClientEvents {
  "player:joined": (p: PlayerSnapshot) => void;
  "player:progress": (p: PlayerProgressEvent) => void;
  "player:left": (p: { userId: string }) => void;
  "room:snapshot": (players: PlayerSnapshot[]) => void;
}

export interface ClientToServerEvents {
  hello: (
    payload: {
      accessToken: string;
      instanceId: string;
      channelId?: string | null;
      tz?: string;
    },
    ack: (result: { ok: true } | { ok: false; error: string }) => void,
  ) => void;
}

export const MAX_GUESSES = 6;
