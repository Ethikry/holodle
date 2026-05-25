import { create } from "zustand";
import type {
  DailyState,
  GameStatus,
  GuessDiff,
  PlayerProgressEvent,
  PlayerSnapshot,
  TalentSummary,
  UserStats,
} from "@holodle/shared";
import { MAX_GUESSES } from "@holodle/shared";

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

  // UI
  helpOpen: boolean;
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

  helpOpen: false,
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
    set((s) => ({
      history: [...s.history, diff],
      status,
      answer: answer ?? s.answer,
    })),
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
  updateProgress: ({ userId, guessesUsed, diff, status }) =>
    set((s) => {
      const existing = s.players.get(userId);
      if (!existing) return s;
      const next = new Map(s.players);
      next.set(userId, {
        ...existing,
        guessesUsed,
        status,
        history: [...existing.history, diff],
      });
      return { players: next };
    }),
  removePlayer: (userId) =>
    set((s) => {
      const next = new Map(s.players);
      next.delete(userId);
      return { players: next };
    }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
