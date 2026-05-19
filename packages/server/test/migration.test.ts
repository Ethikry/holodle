import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Build a database in the OLD (pre-round-2) shape, then point getDb at it
// and assert the additive migrations + indexes all apply cleanly. This
// reproduces the upgrade path that hit a real user; without ordering
// the index creation after the ALTERs, getDb throws "no such column:
// settled_at" before the column gets added.
const tmpDir = mkdtempSync(join(tmpdir(), "holodle-migration-"));
const oldDbPath = join(tmpDir, "old.db");

beforeAll(() => {
  // Old user_day shape: no channel_id/tz/settled_at/exit_embed_posted.
  const old = new Database(oldDbPath);
  old.exec(`
    CREATE TABLE user_day (
      user_id      TEXT NOT NULL,
      day_index    INTEGER NOT NULL,
      guesses_json TEXT NOT NULL DEFAULT '[]',
      status       TEXT NOT NULL DEFAULT 'playing',
      updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (user_id, day_index)
    );
    INSERT INTO user_day (user_id, day_index, guesses_json, status)
      VALUES ('legacy-user', 0, '[]', 'won');
  `);
  old.close();
  process.env.DB_PATH = oldDbPath;
  process.env.NODE_ENV = "test";
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("getDb migration from pre-round-2 shape", () => {
  it("adds the four new user_day columns and creates the settled_at index", async () => {
    const { getDb } = await import("../src/db/client.js");
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(user_day)").all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    for (const c of ["channel_id", "tz", "settled_at", "exit_embed_posted"]) {
      expect(names.has(c)).toBe(true);
    }
    const indexes = db.prepare("PRAGMA index_list('user_day')").all() as Array<{ name: string }>;
    expect(indexes.some((i) => i.name === "idx_user_day_settled")).toBe(true);
  });

  it("preserves existing rows untouched", async () => {
    const { getDb } = await import("../src/db/client.js");
    const row = getDb()
      .prepare("SELECT user_id, status FROM user_day WHERE user_id = 'legacy-user'")
      .get();
    expect(row).toEqual({ user_id: "legacy-user", status: "won" });
  });
});
