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

// No "near" / orange state. Every cell is strictly equal-or-wrong; the year
// column distinguishes the direction of a miss via "higher" (target > guess,
// renders ↑) and "lower" (target < guess, renders ↓).
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
  // Full guess history so the in-iframe sidebar can render every other
  // player's mini board. Empty for any player who hasn't guessed yet.
  history: GuessDiff[];
  status: GameStatus;
}

export interface PlayerProgressEvent {
  userId: string;
  guessesUsed: number;
  // The diff just produced by this guess. Pushed onto the recipient's stored
  // history so the sidebar grids update without a round-trip.
  diff: GuessDiff;
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
