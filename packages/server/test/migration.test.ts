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

// Pre-round-2 GuessDiff shape (note `name`, not `generation`).
const STALE_DIFF_JSON = JSON.stringify([
  {
    talentId: "kobo-kanaeru",
    name: { value: "Kobo Kanaeru", state: "wrong" },
    branch: { value: "ID", state: "equal" },
    debutYear: { value: 2022, state: "equal" },
    archetype: { value: "Human", state: "equal" },
    height: { value: "Med", state: "equal" },
    birthMonth: { value: "December", state: "equal" },
  },
]);

// Current shape: combined `group` cell, no `generation` / `branch`,
// birthMonth equal-or-wrong.
const FRESH_DIFF_JSON = JSON.stringify([
  {
    talentId: "kobo-kanaeru",
    group: { value: "ID Gen 3", state: "equal" },
    penlightColor: { value: "Light Blue", state: "equal" },
    archetype: { value: "Human", state: "equal" },
    height: { value: "Med", state: "equal" },
    birthMonth: { value: "December", state: "equal" },
  },
]);

beforeAll(() => {
  // Old user_day shape: no channel_id/tz/settled_at/exit_embed_posted, plus
  // stored diffs in the legacy `name` shape.
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
  // Row that should be cleared by the data migration.
  old.prepare(
    `INSERT INTO user_day (user_id, day_index, guesses_json, status) VALUES (?,?,?,?)`,
  ).run("stale-user", 800, STALE_DIFF_JSON, "lost");
  // Row that should pass through untouched.
  old.prepare(
    `INSERT INTO user_day (user_id, day_index, guesses_json, status) VALUES (?,?,?,?)`,
  ).run("fresh-user", 801, FRESH_DIFF_JSON, "won");
  // Row with malformed JSON — should also be cleared.
  old.prepare(
    `INSERT INTO user_day (user_id, day_index, guesses_json, status) VALUES (?,?,?,?)`,
  ).run("broken-user", 802, "{ this is not json", "playing");

  // Pre-theme user_prefs row: created with only the recap_ping_muted
  // column (the shape before the theme picker shipped). The additive
  // migration should add the `theme` column with the default value.
  old.exec(`
    CREATE TABLE user_prefs (
      user_id          TEXT PRIMARY KEY,
      recap_ping_muted INTEGER NOT NULL DEFAULT 0,
      updated_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    INSERT INTO user_prefs (user_id, recap_ping_muted)
      VALUES ('pre-theme-user', 1);
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

  it("clears stale pre-round-2 diffs (name without generation) and resets the row", async () => {
    const { getDb } = await import("../src/db/client.js");
    const row = getDb()
      .prepare(
        "SELECT guesses_json, status, settled_at, exit_embed_posted FROM user_day WHERE user_id = 'stale-user'",
      )
      .get() as { guesses_json: string; status: string; settled_at: number | null; exit_embed_posted: number };
    expect(row.guesses_json).toBe("[]");
    expect(row.status).toBe("playing");
    expect(row.settled_at).toBeNull();
    expect(row.exit_embed_posted).toBe(0);
  });

  it("preserves fresh (group-shape) diffs untouched", async () => {
    const { getDb } = await import("../src/db/client.js");
    const row = getDb()
      .prepare("SELECT guesses_json, status FROM user_day WHERE user_id = 'fresh-user'")
      .get() as { guesses_json: string; status: string };
    expect(row.status).toBe("won");
    const parsed = JSON.parse(row.guesses_json);
    expect(parsed[0]).toHaveProperty("group");
    expect(parsed[0]).not.toHaveProperty("name");
    expect(parsed[0]).not.toHaveProperty("generation");
    expect(parsed[0]).not.toHaveProperty("branch");
  });

  it("clears rows with malformed guesses_json", async () => {
    const { getDb } = await import("../src/db/client.js");
    const row = getDb()
      .prepare("SELECT guesses_json, status FROM user_day WHERE user_id = 'broken-user'")
      .get() as { guesses_json: string; status: string };
    expect(row.guesses_json).toBe("[]");
    expect(row.status).toBe("playing");
  });

  it("adds the user_prefs.theme column on a pre-theme database, defaulting to 'sky'", async () => {
    const { getDb } = await import("../src/db/client.js");
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(user_prefs)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "theme")).toBe(true);
    // The legacy row gets the column DEFAULT applied because the ALTER
    // TABLE adds `NOT NULL DEFAULT 'sky'` (restored original palette).
    const row = db
      .prepare("SELECT theme, recap_ping_muted FROM user_prefs WHERE user_id = 'pre-theme-user'")
      .get() as { theme: string; recap_ping_muted: number };
    expect(row.theme).toBe("sky");
    // Pre-existing recap_ping_muted value preserved.
    expect(row.recap_ping_muted).toBe(1);
  });
});
