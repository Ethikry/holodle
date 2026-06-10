// Cross-package types. Both client and server import from "@holodle/shared".
// Keep this file free of runtime code (no Zod, no logic) — types only.

export type Branch = "JP" | "ID" | "EN" | "DEV_IS" | "Stars";

// Cutoffs: <150 → Smol, 150–165 → Med, >165 → Tall.
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
  // Free-form (covers "Gen 0", "GAMERS", "Promise", "Regloss", etc.). May
  // be an array for talents that legitimately belong to multiple groups
  // (e.g. Fubuki: Gen 1 + GAMERS). A guess counts as a match when the
  // guess and target sets overlap by at least one value.
  generation: string | string[];
  // Retained alongside `penlightColor` so we can revert to year-based
  // matching without re-collecting data. Not used for diffing today.
  debutYear: number;
  // Same multi-value semantics as `generation` — Nerissa is Bird + Demon.
  archetype: string | string[];
  // Penlight color from hololive 7th fes. May be null for talents who never
  // had an assigned color (e.g. Sana, Aloe).
  penlightColor: string | null;
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

// Three-state cells:
//   - "equal":   exact full match
//   - "partial": only used by the combined group column today — exactly
//                one of (branch, generation) matches. Renders yellow.
//   - "wrong":   no match.
// The prior "higher" / "lower" directional states (used for debut year +
// birth month arrows) have been retired; birth month is now equal-or-wrong.
export type CellState = "equal" | "wrong" | "partial";

export interface AttrCell<V> {
  value: V;
  state: CellState;
}

export interface GuessDiff {
  talentId: string;
  // Branch (JP / EN / ID / DEV_IS / Stars). Binary equal/wrong.
  branch: AttrCell<Branch>;
  // Generation column (legacy field name "group" preserved for
  // backwards compatibility with stored rows). Value is the gen
  // label only — e.g. "Gen 2", "Gen 6 (holoX)", or "Gen 1 / GAMERS"
  // for multi-gen talents like Fubuki. Binary equal/wrong: matches
  // by displayed gen NUMBER across branches (Aqua's "Gen 2" matches
  // Fauna's "Gen 2 (Promise)").
  group: AttrCell<string>;
  penlightColor: AttrCell<string>;
  archetype: AttrCell<string>;
  height: AttrCell<HeightBucket>;
  birthMonth: AttrCell<Month>;
}

// Column order for board rows derived from a GuessDiff. Defined as a shared
// constant so both client and server agree on the order of cell states.
export const BOARD_COLUMNS: ReadonlyArray<keyof Omit<GuessDiff, "talentId">> = [
  "branch",
  "group",
  "penlightColor",
  "archetype",
  "height",
  "birthMonth",
];

export function boardRowFromDiff(diff: GuessDiff): CellState[] {
  // Defensive: legacy rows persisted under the prior schema (e.g. `debutYear`
  // before the penlight-color swap) may be missing a cell entirely. Render
  // those slots as a plain "wrong" rather than throwing.
  return BOARD_COLUMNS.map((k) => diff[k]?.state ?? "wrong");
}

export type GameStatus = "playing" | "won" | "lost";

export interface DailyState {
  puzzleId: string; // e.g. "2026-05-18"
  guessesUsed: number;
  history: GuessDiff[];
  status: GameStatus;
  maxGuesses: number; // always 6
  // On terminal status the server reveals the answer so a returning
  // player who's already finished today's puzzle can see the talent +
  // avatar on the auto-opened recap overlay. Only present when
  // status !== "playing"; in-progress days do NOT leak the answer.
  answer?: TalentSummary;
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
  // Lifetime final-guess-count distribution for the result screen:
  // wins bucketed by guess count (1-6), plus a flat losses count.
  guessDistribution: {
    wins: Record<number, number>;
    losses: number;
  };
}

// Admin-only aggregated statistics across all users.
export interface AdminStats {
  generatedAt: number; // unix timestamp in seconds
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  winRate: number; // 0..1
  averageGuessesPerWin: number;
  averageGuessesPerGame: number;
  guessDistribution: Record<number, number>; // 1-6 → count of games
  // Guess-count histogram split by outcome (1-6 each). Losses cluster at 6.
  guessDistributionByOutcome: {
    win: Record<number, number>;
    loss: Record<number, number>;
  };
  // `count` = total times guessed; `nonAnswerCount` excludes self-answer
  // winning guesses (guesses where the talent WAS that day's answer).
  talentGuessFrequency: Array<{ talentId: string; count: number; nonAnswerCount: number }>;
  dailyPickFrequency: Array<{ talentId: string; count: number }>;
  // How often each talent is the SECOND guess (guesses[1]).
  secondGuessFrequency: Array<{ talentId: string; count: number }>;
  attributeAccuracy: Record<string, number>; // "branch" | "generation" | "archetype" | "height" | "birthMonth" → 0..1
  activityByDate: Array<{ date: string; games: number; wins: number }>;
  // Per-answer-talent difficulty (only talents that have been a daily answer).
  perAnswerTalent: Array<{
    talentId: string;
    plays: number;
    wins: number;
    winRate: number; // 0..1
    avgGuesses: number;
  }>;
  // What players open with: opening-guess talent → count.
  firstGuessFrequency: Array<{ talentId: string; count: number }>;
  // How effective each opening guess is, ranked best-first.
  firstGuessEffectiveness: Array<{
    talentId: string;
    plays: number;
    wins: number;
    winRate: number; // 0..1
    avgGuessesToWin: number;
  }>;
  // Per-attribute cell-state tally across all guesses.
  attributeBreakdown: Record<string, { equal: number; partial: number; wrong: number }>;
  // "Given this feedback pattern, what did players guess next?" Keyed by an
  // E/P/X six-char pattern (attribute order: branch, group, penlightColor,
  // archetype, height, birthMonth); value is the top next-guesses for that
  // pattern. Only observed patterns are present.
  nextGuessByFeedback: Record<string, Array<{ talentId: string; count: number }>>;
  // Reach: distinct players/channels and the solo-vs-channel game split.
  reach: {
    uniquePlayers: number;
    distinctChannels: number;
    soloGames: number;
    channelGames: number;
  };
}

// A single guess row reduced to its 5 cell-state colors (one per
// BOARD_COLUMNS entry). Values are stripped so we never leak what talent
// another player guessed — only whether each attribute matched. Used by
// the boards panel so spectators can see every player's progress as a
// colored grid.
export type BoardRow = CellState[];

// Socket.IO event payloads
export interface PlayerSnapshot {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  guessesUsed: number;
  status: GameStatus;
  // Each row is a 6-tuple of CellStates (one per BOARD_COLUMNS entry).
  // Length equals guessesUsed; older snapshots from completed players are
  // loaded from the DB on socket connect. We intentionally do NOT broadcast
  // the full GuessDiff (with talent ids + attribute values) — only cell
  // colors — so spectators can't see what talents other players guessed.
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
