// Cross-package types. Both client and server import from "@holodle/shared".
// Keep this file free of runtime code (no Zod, no logic) — types only.

export type Branch = "JP" | "ID" | "EN" | "DEV_IS" | "Stars";

export type HeightBucket = "Small" | "Med" | "Tall";

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

export type CellState =
  | "equal"
  | "wrong"
  | "near"
  | "higher" // numeric: target > guess (show ↑)
  | "lower"; // numeric: target < guess (show ↓)

export interface AttrCell<V> {
  value: V;
  state: CellState;
}

export interface GuessDiff {
  talentId: string;
  // Echoed so the client can show what was guessed without a second lookup.
  name: AttrCell<string>;
  branch: AttrCell<Branch>;
  debutYear: AttrCell<number>;
  archetype: AttrCell<string>;
  height: AttrCell<HeightBucket>;
  birthMonth: AttrCell<Month>;
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

// Socket.IO event payloads
export interface PlayerSnapshot {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  guessesUsed: number;
  status: GameStatus;
}

export interface PlayerProgressEvent {
  userId: string;
  guessesUsed: number;
  status: GameStatus;
}

export interface ServerToClientEvents {
  "player:joined": (p: PlayerSnapshot) => void;
  "player:progress": (p: PlayerProgressEvent) => void;
  "player:left": (p: { userId: string }) => void;
  "room:snapshot": (players: PlayerSnapshot[]) => void;
}

export interface ClientToServerEvents {
  hello: (
    payload: { accessToken: string; instanceId: string },
    ack: (result: { ok: true } | { ok: false; error: string }) => void,
  ) => void;
}

export const MAX_GUESSES = 6;
