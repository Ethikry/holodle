import { create } from "zustand";
import type {
  BoardRow,
  DailyState,
  GameStatus,
  GuessDiff,
  PlayerProgressEvent,
  PlayerSnapshot,
  TalentSummary,
  UserStats,
} from "@holodle/shared";
import { MAX_GUESSES } from "@holodle/shared";
import type { UserPrefs } from "../net/api.js";

interface GameState {
  // Identity / session
  accessToken: string | null;
  instanceId: string | null;
  channelId: string | null;
  selfUserId: string | null;

  // Catalog
  talents: TalentSummary[];

  // Daily puzzle
  puzzleId: string | null;
  history: GuessDiff[];
  status: GameStatus;
  answer: TalentSummary | null; // revealed only on win/loss
  maxGuesses: number;

  // Stats
  stats: UserStats;

  // Multiplayer presence
  players: Map<string, PlayerSnapshot>;

  // Per-user preferences. Fetched at bootstrap; mirrors the server shape.
  prefs: UserPrefs;

  // UI
  helpOpen: boolean;
  // Full-screen post-completion stats overlay. Auto-opens when a guess
  // transitions the user to a terminal status (won/lost) within this
  // session; manually re-openable via the "View recap" button.
  recapOpen: boolean;
  loading: boolean;
  error: string | null;
}

interface GameActions {
  setSession: (s: {
    accessToken: string;
    instanceId: string;
    channelId: string | null;
    selfUserId: string;
  }) => void;
  setTalents: (t: TalentSummary[]) => void;
  setDaily: (d: DailyState) => void;
  appendGuess: (diff: GuessDiff, status: GameStatus, answer?: TalentSummary) => void;
  setStats: (s: UserStats) => void;
  upsertPlayer: (p: PlayerSnapshot) => void;
  setSnapshot: (players: PlayerSnapshot[]) => void;
  updateProgress: (p: PlayerProgressEvent) => void;
  removePlayer: (userId: string) => void;
  setHelpOpen: (open: boolean) => void;
  setRecapOpen: (open: boolean) => void;
  setPrefs: (prefs: UserPrefs) => void;
  setLoading: (loading: boolean) => void;
  setError: (err: string | null) => void;
}

export const useGame = create<GameState & GameActions>((set) => ({
  accessToken: null,
  instanceId: null,
  channelId: null,
  selfUserId: null,

  talents: [],
  puzzleId: null,
  history: [],
  status: "playing",
  answer: null,
  maxGuesses: MAX_GUESSES,

  stats: { streak: 0, best: 0, played: 0, winRate: 0 },
  players: new Map(),

  prefs: { recapPingMuted: false, theme: "warm-pastel" },

  helpOpen: false,
  recapOpen: false,
  // Start as `true` so the first paint shows the LoadingScreen rather than
  // a half-populated UI. The App.tsx bootstrap effect flips this to false
  // once talents + session + daily + stats + socket are all wired up.
  loading: true,
  error: null,

  setSession: ({ accessToken, instanceId, channelId, selfUserId }) =>
    set({ accessToken, instanceId, channelId, selfUserId }),
  setTalents: (talents) => set({ talents }),
  setDaily: (d) =>
    set({
      puzzleId: d.puzzleId,
      history: d.history,
      status: d.status,
      maxGuesses: d.maxGuesses,
      // answer is not in DailyState — only revealed by /api/guess on settle.
    }),
  appendGuess: (diff, status, answer) =>
    set((s) => {
      // Open the post-completion overlay when a guess settles the game,
      // but defer it by ~1.4s so the final row's cell-reveal animation
      // has time to land first. Only schedule on the playing → terminal
      // transition so a reload of an already-settled day doesn't pop
      // the overlay every refresh — the user can re-open via "View
      // recap" any time.
      const justSettled = s.status === "playing" && status !== "playing";
      if (justSettled) {
        window.setTimeout(() => set({ recapOpen: true }), 1400);
      }
      return {
        history: [...s.history, diff],
        status,
        answer: answer ?? s.answer,
      };
    }),
  setStats: (stats) => set({ stats }),
  upsertPlayer: (p) =>
    set((s) => {
      const next = new Map(s.players);
      next.set(p.userId, p);
      return { players: next };
    }),
  setSnapshot: (players) =>
    set({
      players: new Map(players.map((p) => [p.userId, p])),
    }),
  updateProgress: ({ userId, guessesUsed, status, board }) =>
    set((s) => {
      const existing = s.players.get(userId);
      const next = new Map(s.players);
      if (existing) {
        next.set(userId, { ...existing, guessesUsed, status, board });
      } else {
        // Progress can arrive before the joined event (e.g. when a player
        // is already in channel_daily_participant but we haven't received
        // their snapshot yet). Materialize a partial entry rather than
        // dropping the update.
        next.set(userId, {
          userId,
          displayName: userId,
          avatarUrl: null,
          guessesUsed,
          status,
          board,
        });
      }
      return { players: next };
    }),
  removePlayer: (userId) =>
    set((s) => {
      const next = new Map(s.players);
      next.delete(userId);
      return { players: next };
    }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setRecapOpen: (recapOpen) => set({ recapOpen }),
  setPrefs: (prefs) => set({ prefs }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
