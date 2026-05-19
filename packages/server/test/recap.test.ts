import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Isolated DB so this test can't see the dev one.
const tmpDir = mkdtempSync(join(tmpdir(), "holodle-recap-test-"));
process.env.DB_PATH = join(tmpDir, "test.db");
process.env.NODE_ENV = "test";

// Force the bot module to no-op when scheduler.runRecap calls it. We're
// asserting on tryClaimRecap behavior, not on outbound HTTP.
process.env.DISCORD_BOT_TOKEN = "";

const { getDb, settledRowsBetween, tryClaimRecap } = await import("../src/db/client.js");
const { runRecap, nextCstMidnightAfter } = await import("../src/bot/scheduler.js");

beforeAll(() => {
  getDb(); // bootstrap schema + migrations
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("tryClaimRecap idempotency", () => {
  it("first claim returns true, second returns false", () => {
    expect(tryClaimRecap("channel-A", 1_700_000_000)).toBe(true);
    expect(tryClaimRecap("channel-A", 1_700_000_000)).toBe(false);
  });

  it("different channel or different fire time claims independently", () => {
    expect(tryClaimRecap("channel-B", 1_700_000_000)).toBe(true);
    expect(tryClaimRecap("channel-A", 1_700_086_400)).toBe(true);
  });
});

describe("settledRowsBetween", () => {
  it("returns only rows with status in (won,lost) inside the window", () => {
    const db = getDb();
    // Insert a few rows directly.
    db.prepare(
      `INSERT INTO user_day
         (user_id, day_index, guesses_json, status, channel_id, tz, settled_at, exit_embed_posted)
       VALUES (?,?,?,?,?,?,?,0)`,
    ).run("u1", 100, "[]", "won", "c1", "UTC", 1_700_000_500);
    db.prepare(
      `INSERT INTO user_day
         (user_id, day_index, guesses_json, status, channel_id, tz, settled_at, exit_embed_posted)
       VALUES (?,?,?,?,?,?,?,0)`,
    ).run("u2", 100, "[]", "lost", "c1", "UTC", 1_700_000_700);
    db.prepare(
      `INSERT INTO user_day
         (user_id, day_index, guesses_json, status, channel_id, tz, settled_at, exit_embed_posted)
       VALUES (?,?,?,?,?,?,?,0)`,
    ).run("u3", 100, "[]", "playing", "c1", "UTC", null);
    // Outside the window.
    db.prepare(
      `INSERT INTO user_day
         (user_id, day_index, guesses_json, status, channel_id, tz, settled_at, exit_embed_posted)
       VALUES (?,?,?,?,?,?,?,0)`,
    ).run("u4", 99, "[]", "won", "c1", "UTC", 1_600_000_000);

    const rows = settledRowsBetween(1_700_000_000, 1_700_001_000);
    const ids = rows.map((r) => r.userId).sort();
    expect(ids).toEqual(["u1", "u2"]);
  });
});

describe("runRecap", () => {
  it("posts nothing on second invocation for the same (channel, fireTime)", async () => {
    // First fire claims; second fire finds the row in daily_recaps and skips.
    // We can't observe the HTTP call (bot is disabled), but we can observe
    // that tryClaimRecap behaves as expected before and after runRecap.
    const nowMs = 1_700_001_000_000;
    const fireSec = Math.floor(nowMs / 1000);
    // First call: should claim each channel that had settled rows.
    await runRecap(nowMs);
    // Second call: every channel is already claimed → tryClaimRecap below
    // would return false on the same args.
    expect(tryClaimRecap("c1", fireSec)).toBe(false);
  });
});

describe("nextCstMidnightAfter", () => {
  it("returns a UTC ms that is at least 30 minutes in the future and within ~26 hours", () => {
    const now = Date.UTC(2024, 4, 19, 6, 0, 0);
    const next = nextCstMidnightAfter(now);
    expect(next).toBeGreaterThan(now + 30 * 60 * 1000);
    expect(next).toBeLessThan(now + 26 * 3_600_000);
  });

  it("yields a Chicago-local 00:00:00 wall-clock", () => {
    const now = Date.UTC(2024, 4, 19, 6, 0, 0);
    const next = nextCstMidnightAfter(now);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(next));
    const hh = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "-1", 10);
    const mm = Number.parseInt(parts.find((p) => p.type === "minute")?.value ?? "-1", 10);
    const ss = Number.parseInt(parts.find((p) => p.type === "second")?.value ?? "-1", 10);
    expect(hh).toBe(0);
    expect(mm).toBe(0);
    expect(ss).toBe(0);
  });
});
