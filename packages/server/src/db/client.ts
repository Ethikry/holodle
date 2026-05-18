import Database from "better-sqlite3";
import type { GameStatus, GuessDiff, UserStats } from "@holodle/shared";
import { env } from "../env.js";
import { SCHEMA_SQL } from "./schema.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(env.DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

export interface UserDayRow {
  userId: string;
  dayIndex: number;
  guesses: GuessDiff[];
  status: GameStatus;
}

export function loadUserDay(userId: string, dayIndex: number): UserDayRow {
  const row = getDb()
    .prepare(
      `SELECT guesses_json, status FROM user_day WHERE user_id = ? AND day_index = ?`,
    )
    .get(userId, dayIndex) as { guesses_json: string; status: GameStatus } | undefined;
  if (!row) return { userId, dayIndex, guesses: [], status: "playing" };
  return {
    userId,
    dayIndex,
    guesses: JSON.parse(row.guesses_json) as GuessDiff[],
    status: row.status,
  };
}

export function saveUserDay(row: UserDayRow): void {
  getDb()
    .prepare(
      `INSERT INTO user_day (user_id, day_index, guesses_json, status, updated_at)
       VALUES (?, ?, ?, ?, strftime('%s','now'))
       ON CONFLICT(user_id, day_index) DO UPDATE SET
         guesses_json = excluded.guesses_json,
         status       = excluded.status,
         updated_at   = excluded.updated_at`,
    )
    .run(row.userId, row.dayIndex, JSON.stringify(row.guesses), row.status);
}

export function loadStats(userId: string): UserStats & { lastDayIndex: number | null } {
  const row = getDb()
    .prepare(
      `SELECT streak, best, played, wins, last_day_index FROM user_stats WHERE user_id = ?`,
    )
    .get(userId) as
    | { streak: number; best: number; played: number; wins: number; last_day_index: number | null }
    | undefined;
  if (!row) {
    return { streak: 0, best: 0, played: 0, winRate: 0, lastDayIndex: null };
  }
  const winRate = row.played === 0 ? 0 : row.wins / row.played;
  return {
    streak: row.streak,
    best: row.best,
    played: row.played,
    winRate,
    lastDayIndex: row.last_day_index,
  };
}

// Update aggregated stats when a day settles. Idempotent per (user, dayIndex).
export function settleDay(userId: string, dayIndex: number, won: boolean): void {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT streak, best, played, wins, last_day_index FROM user_stats WHERE user_id = ?`,
    )
    .get(userId) as
    | { streak: number; best: number; played: number; wins: number; last_day_index: number | null }
    | undefined;

  // Guard against double-settle. If last_day_index === dayIndex, this day was
  // already counted — bail.
  if (existing && existing.last_day_index === dayIndex) return;

  let streak: number;
  if (won) {
    if (existing && existing.last_day_index === dayIndex - 1) {
      streak = existing.streak + 1;
    } else {
      streak = 1;
    }
  } else {
    streak = 0;
  }

  const played = (existing?.played ?? 0) + 1;
  const wins = (existing?.wins ?? 0) + (won ? 1 : 0);
  const best = Math.max(existing?.best ?? 0, streak);

  db.prepare(
    `INSERT INTO user_stats (user_id, streak, best, played, wins, last_day_index)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       streak = excluded.streak,
       best = excluded.best,
       played = excluded.played,
       wins = excluded.wins,
       last_day_index = excluded.last_day_index`,
  ).run(userId, streak, best, played, wins, dayIndex);
}
