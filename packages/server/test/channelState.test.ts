import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuessDiff } from "@holodle/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "holodle-channelstate-"));
process.env.DB_PATH = join(tmpDir, "test.db");
process.env.NODE_ENV = "test";

// Stub the image renderer — these tests are about state transitions, not
// canvas output. Without this, every recordParticipantProgress that fires a
// patch would spin up @napi-rs/canvas to composite a PNG we throw away.
vi.mock("../src/discord/imageRender.js", () => ({
  renderNowPlayingImage: vi.fn(async () => Buffer.from([0])),
}));

const { getDb } = await import("../src/db/client.js");
const {
  upsertChannelToken,
  setChannelMessageId,
  getChannelState,
  upsertParticipant,
  listParticipants,
  listYesterdayRecapPlayers,
  recordParticipantProgress,
  syncChannelEmbed,
  isStaleMessage,
  findMostRecentUnpostedRecapPuzzle,
  tryClaimRecapPosted,
  computeChannelStreak,
} = await import("../src/game/channelState.js");
const { dayIndexForPuzzleId } = await import("../src/game/dailyPicker.js");

beforeAll(() => {
  getDb();
});

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM channel_daily_state");
  db.exec("DELETE FROM channel_daily_participant");
  db.exec("DELETE FROM channel_recap_posted");
  db.exec("DELETE FROM user_day");
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// Minimal GuessDiff stub. recordParticipantProgress only JSON.stringifies
// these into channel_daily_participant.guesses_json, and listParticipants
// passes them straight to the (mocked) image renderer, so they don't need
// real attribute data.
function stubDiffs(n: number): GuessDiff[] {
  const diffs: GuessDiff[] = [];
  for (let i = 0; i < n; i++) {
    diffs.push({
      talentId: `t-${i}`,
      generation: { value: "?", state: "wrong" },
      branch: { value: "JP", state: "wrong" },
      debutYear: { value: 2020, state: "wrong" },
      archetype: { value: "?", state: "wrong" },
      height: { value: "Med", state: "wrong" },
      birthMonth: { value: "January", state: "wrong" },
    });
  }
  return diffs;
}

describe("upsertChannelToken", () => {
  it("creates a row on first call and overwrites the token on subsequent calls", () => {
    const s1 = upsertChannelToken("c1", "2026-05-19", "tok-A", "app-1", 1_000_000);
    expect(s1.latestToken).toBe("tok-A");
    expect(s1.messageId).toBeNull();
    expect(s1.latestTokenExp).toBe(1_000_000 + 900);

    const s2 = upsertChannelToken("c1", "2026-05-19", "tok-B", "app-1", 1_000_500);
    expect(s2.latestToken).toBe("tok-B");
    expect(s2.latestTokenExp).toBe(1_000_500 + 900);
  });

  it("preserves the message_id across token refreshes", () => {
    upsertChannelToken("c1", "2026-05-19", "tok-A", "app-1", 1_000_000);
    setChannelMessageId("c1", "2026-05-19", "msg-123");
    upsertChannelToken("c1", "2026-05-19", "tok-B", "app-1", 1_000_500);
    const state = getChannelState("c1", "2026-05-19");
    expect(state?.messageId).toBe("msg-123");
    expect(state?.latestToken).toBe("tok-B");
  });
});

describe("upsertParticipant", () => {
  it("inserts new participants and preserves progress on re-launch", () => {
    upsertParticipant({
      channelId: "c1",
      puzzleId: "2026-05-19",
      userId: "u1",
      displayName: "Alice",
    });
    // Simulate progress via direct UPDATE.
    getDb()
      .prepare(
        `UPDATE channel_daily_participant
            SET guesses_used = 3, status = 'playing'
          WHERE user_id = 'u1'`,
      )
      .run();
    // Re-launch with the same user — display_name may change, but the
    // existing guesses_used/status row must NOT be reset.
    upsertParticipant({
      channelId: "c1",
      puzzleId: "2026-05-19",
      userId: "u1",
      displayName: "Alice-renamed",
    });
    const ps = listParticipants("c1", "2026-05-19");
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({
      userId: "u1",
      displayName: "Alice-renamed",
      guessesUsed: 3,
      status: "playing",
    });
  });
});

describe("recordParticipantProgress token chaining", () => {
  beforeEach(() => {
    upsertParticipant({
      channelId: "c1",
      puzzleId: "2026-05-19",
      userId: "u1",
      displayName: "Alice",
    });
  });

  it("PATCHes the message when the latest token is still fresh", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    const now = 1_700_000_000;
    upsertChannelToken("c1", "2026-05-19", "tok-fresh", "app-1", now);
    setChannelMessageId("c1", "2026-05-19", "msg-1");

    await recordParticipantProgress(
      "u1",
      "c1",
      "2026-05-19",
      "Alice",
      stubDiffs(4),
      "won",
      now + 60,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/webhooks/app-1/tok-fresh/messages/msg-1");
    expect(init.method).toBe("PATCH");
    fetchSpy.mockRestore();
  });

  it("is a no-op when the token has expired", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(""));
    const now = 1_700_000_000;
    upsertChannelToken("c1", "2026-05-19", "tok-stale", "app-1", now);
    setChannelMessageId("c1", "2026-05-19", "msg-1");

    // 16 minutes after the token was issued — well past the 15-minute TTL.
    await recordParticipantProgress(
      "u1",
      "c1",
      "2026-05-19",
      "Alice",
      stubDiffs(4),
      "won",
      now + 16 * 60,
    );

    // Participant row still gets updated even when no patch fires.
    const ps = listParticipants("c1", "2026-05-19");
    expect(ps[0]).toMatchObject({ guessesUsed: 4, status: "won" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("POSTs a new embed when state exists but no message has been posted yet", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "new-msg", channel_id: "c1" }), { status: 200 }),
      );
    const now = 1_700_000_000;
    upsertChannelToken("c1", "2026-05-19", "tok-fresh", "app-1", now);
    // No setChannelMessageId — message hasn't been posted yet.

    await recordParticipantProgress(
      "u1",
      "c1",
      "2026-05-19",
      "Alice",
      stubDiffs(4),
      "won",
      now + 60,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/webhooks/app-1/tok-fresh?wait=true");
    expect(init.method).toBe("POST");
    // message_id captured from the POST response is now persisted.
    expect(getChannelState("c1", "2026-05-19")?.messageId).toBe("new-msg");
    fetchSpy.mockRestore();
  });

  it("borrows a fresh token from another puzzle when no state exists for this one", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "new-msg", channel_id: "c1" }), { status: 200 }),
      );
    const now = 1_700_000_000;
    // Yesterday's row holds the fresh token; today's puzzle has no row at all.
    upsertChannelToken("c1", "2026-05-19", "tok-fresh", "app-1", now);
    setChannelMessageId("c1", "2026-05-19", "msg-old");

    await recordParticipantProgress(
      "u1",
      "c1",
      "2026-05-20",
      "Alice",
      stubDiffs(3),
      "won",
      now + 60,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    // POST (not PATCH) since 2026-05-20 had no message yet.
    expect(init.method).toBe("POST");
    expect(url).toContain("/webhooks/app-1/tok-fresh?wait=true");
    // New row for 2026-05-20 was created with the borrowed token + new msg id.
    const next = getChannelState("c1", "2026-05-20");
    expect(next?.latestToken).toBe("tok-fresh");
    expect(next?.messageId).toBe("new-msg");
    fetchSpy.mockRestore();
  });
});

describe("isStaleMessage", () => {
  it("is false when no message has been posted yet", () => {
    const now = 1_700_000_000;
    upsertChannelToken("c1", "2026-05-19", "tok", "app-1", now);
    const state = getChannelState("c1", "2026-05-19");
    expect(state && isStaleMessage(state, now + 24 * 3600)).toBe(false);
  });

  it("is false during normal back-and-forth (recent edits within an hour)", () => {
    const now = 1_700_000_000;
    upsertChannelToken("c1", "2026-05-19", "tok", "app-1", now);
    setChannelMessageId("c1", "2026-05-19", "msg-1", now);
    const state = getChannelState("c1", "2026-05-19");
    // 25 minutes since post + last edit → not stale.
    expect(state && isStaleMessage(state, now + 25 * 60)).toBe(false);
  });

  it("is true when more than 60 minutes have passed since the original post", () => {
    const now = 1_700_000_000;
    upsertChannelToken("c1", "2026-05-19", "tok", "app-1", now);
    setChannelMessageId("c1", "2026-05-19", "msg-1", now);
    // Bump updated_at recently so only the age threshold is responsible.
    getDb()
      .prepare(
        `UPDATE channel_daily_state SET message_updated_at = ? WHERE channel_id = ? AND puzzle_id = ?`,
      )
      .run(now + 65 * 60, "c1", "2026-05-19");
    const state = getChannelState("c1", "2026-05-19");
    expect(state && isStaleMessage(state, now + 65 * 60)).toBe(true);
  });

  it("is true when the message hasn't been edited in 30+ minutes", () => {
    const now = 1_700_000_000;
    upsertChannelToken("c1", "2026-05-19", "tok", "app-1", now);
    setChannelMessageId("c1", "2026-05-19", "msg-1", now);
    const state = getChannelState("c1", "2026-05-19");
    // 31 minutes since last edit; total age also 31 min (under 60-min cap)
    // — so only the idle threshold drives the result.
    expect(state && isStaleMessage(state, now + 31 * 60)).toBe(true);
  });

  it("is true for legacy rows where message_id is set but both timestamps are NULL", () => {
    const now = 1_700_000_000;
    upsertChannelToken("c1", "2026-05-19", "tok", "app-1", now);
    // Simulate a row that pre-dates the staleness-tracking deploy: messageId
    // is set, but timestamps were never written.
    getDb()
      .prepare(
        `UPDATE channel_daily_state
            SET message_id = ?, message_created_at = NULL, message_updated_at = NULL
          WHERE channel_id = ? AND puzzle_id = ?`,
      )
      .run("legacy-msg", "c1", "2026-05-19");
    const state = getChannelState("c1", "2026-05-19");
    expect(state?.messageCreatedAt).toBeNull();
    expect(state?.messageUpdatedAt).toBeNull();
    expect(state && isStaleMessage(state, now)).toBe(true);
  });
});

describe("syncChannelEmbed supersede flow", () => {
  beforeEach(() => {
    upsertParticipant({
      channelId: "c1",
      puzzleId: "2026-05-19",
      userId: "u1",
      displayName: "Alice",
    });
  });

  it("PATCHes old to past tense + POSTs new with message_reference when stale", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 200 })) // PATCH old
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "new-msg", channel_id: "c1" }), { status: 200 }),
      ); // POST new
    const now = 1_700_000_000;
    upsertChannelToken("c1", "2026-05-19", "tok-fresh", "app-1", now + 80 * 60);
    setChannelMessageId("c1", "2026-05-19", "old-msg", now);

    // 80 minutes after the original post — past the 60-min age threshold.
    await recordParticipantProgress(
      "u1",
      "c1",
      "2026-05-19",
      "Alice",
      stubDiffs(3),
      "playing",
      now + 80 * 60,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [patchUrl, patchInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const [postUrl, postInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(patchInit.method).toBe("PATCH");
    expect(patchUrl).toContain("/messages/old-msg");
    expect(postInit.method).toBe("POST");
    expect(postUrl).toContain("/webhooks/app-1/tok-fresh?wait=true");

    // POST payload was multipart (carries the PNG); the payload_json field
    // inside has message_reference + the past-tense participants are
    // implicit (we don't snapshot the body here, but state moves on).
    const next = getChannelState("c1", "2026-05-19");
    expect(next?.messageId).toBe("new-msg");
    expect(next?.messageCreatedAt).toBe(now + 80 * 60);
    fetchSpy.mockRestore();
  });

  it("does NOT supersede a stale embed when allowSupersede is false (passive launch)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    const now = 1_700_000_000;
    upsertChannelToken("c1", "2026-05-19", "tok-fresh", "app-1", now + 80 * 60);
    setChannelMessageId("c1", "2026-05-19", "old-msg", now);

    // 80 minutes after the original post — stale by age. But this is a
    // /launch-style sync (allowSupersede defaults to false), so the
    // expected behavior is in-place PATCH, not supersede.
    await syncChannelEmbed("c1", "2026-05-19", {}, now + 80 * 60);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(url).toContain("/messages/old-msg");
    // Same message_id retained.
    const next = getChannelState("c1", "2026-05-19");
    expect(next?.messageId).toBe("old-msg");
    fetchSpy.mockRestore();
  });

  it("PATCHes in place when message is still fresh (under both thresholds)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    const now = 1_700_000_000;
    upsertChannelToken("c1", "2026-05-19", "tok-fresh", "app-1", now);
    setChannelMessageId("c1", "2026-05-19", "msg-1", now);

    // 5 minutes after post — well within both thresholds.
    await recordParticipantProgress(
      "u1",
      "c1",
      "2026-05-19",
      "Alice",
      stubDiffs(2),
      "playing",
      now + 5 * 60,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(url).toContain("/messages/msg-1");
    // message_updated_at gets bumped on successful PATCH.
    const next = getChannelState("c1", "2026-05-19");
    expect(next?.messageId).toBe("msg-1");
    expect(next?.messageUpdatedAt).toBe(now + 5 * 60);
    fetchSpy.mockRestore();
  });
});

describe("findMostRecentUnpostedRecapPuzzle", () => {
  beforeEach(() => {
    // Three days of settled plays in channel c1.
    for (const [puzzleId, userId] of [
      ["2026-05-15", "u1"],
      ["2026-05-18", "u2"],
      ["2026-05-20", "u3"],
    ] as const) {
      upsertParticipant({ channelId: "c1", puzzleId, userId, displayName: userId });
      getDb()
        .prepare(
          `UPDATE channel_daily_participant SET status='won', guesses_used=3 WHERE channel_id='c1' AND puzzle_id=? AND user_id=?`,
        )
        .run(puzzleId, userId);
    }
  });

  it("returns the most recent puzzle older than today with settled plays", () => {
    expect(findMostRecentUnpostedRecapPuzzle("c1", "2026-05-25")).toBe("2026-05-20");
  });

  it("skips puzzles that have already been recapped", () => {
    tryClaimRecapPosted("c1", "2026-05-20");
    expect(findMostRecentUnpostedRecapPuzzle("c1", "2026-05-25")).toBe("2026-05-18");
    tryClaimRecapPosted("c1", "2026-05-18");
    tryClaimRecapPosted("c1", "2026-05-15");
    expect(findMostRecentUnpostedRecapPuzzle("c1", "2026-05-25")).toBeNull();
  });

  it("excludes today's puzzle", () => {
    // 2026-05-20 has settled plays but is == today → skip.
    expect(findMostRecentUnpostedRecapPuzzle("c1", "2026-05-20")).toBe("2026-05-18");
  });

  it("returns null when nothing eligible exists in this channel", () => {
    expect(findMostRecentUnpostedRecapPuzzle("c2", "2026-05-25")).toBeNull();
  });
});

describe("computeChannelStreak", () => {
  beforeEach(() => {
    // 4 consecutive days of settled plays in c1, ending 2026-05-20.
    for (const puzzleId of ["2026-05-17", "2026-05-18", "2026-05-19", "2026-05-20"]) {
      upsertParticipant({ channelId: "c1", puzzleId, userId: "u1", displayName: "u1" });
      getDb()
        .prepare(
          `UPDATE channel_daily_participant SET status='won', guesses_used=3 WHERE puzzle_id=?`,
        )
        .run(puzzleId);
    }
    // Gap day with no plays at 2026-05-16. Then more settled plays earlier.
    for (const puzzleId of ["2026-05-13", "2026-05-14", "2026-05-15"]) {
      upsertParticipant({ channelId: "c1", puzzleId, userId: "u1", displayName: "u1" });
      getDb()
        .prepare(
          `UPDATE channel_daily_participant SET status='won', guesses_used=4 WHERE puzzle_id=?`,
        )
        .run(puzzleId);
    }
  });

  it("counts consecutive settled days ending at the target puzzle", () => {
    expect(computeChannelStreak("c1", "2026-05-20")).toBe(4);
  });

  it("stops at the first gap", () => {
    expect(computeChannelStreak("c1", "2026-05-15")).toBe(3);
  });

  it("returns 0 when the target puzzle itself has no settled plays", () => {
    expect(computeChannelStreak("c1", "2026-05-21")).toBe(0);
  });

  it("returns 0 for a channel with no plays", () => {
    expect(computeChannelStreak("c2", "2026-05-20")).toBe(0);
  });
});

describe("listYesterdayRecapPlayers user_day backfill", () => {
  it("falls back to user_day.guesses_json when channel-side json is empty", () => {
    // Channel-side: empty guesses_json + status='won' (the bug shape from
    // the production data we saw on 2026-05-20).
    upsertParticipant({
      channelId: "c1",
      puzzleId: "2026-05-20",
      userId: "legacy",
      displayName: "Legacy",
    });
    getDb()
      .prepare(
        `UPDATE channel_daily_participant
            SET status='won', guesses_used=4, guesses_json='[]'
          WHERE user_id='legacy'`,
      )
      .run();
    // user_day has a real history for the same dayIndex.
    const dayIndex = dayIndexForPuzzleId("2026-05-20");
    const userDayHistory = JSON.stringify([{ talentId: "t-1", marker: "from-userday" }]);
    getDb()
      .prepare(
        `INSERT INTO user_day (user_id, day_index, guesses_json, status, updated_at)
         VALUES (?, ?, ?, ?, strftime('%s','now'))`,
      )
      .run("legacy", dayIndex, userDayHistory, "won");

    const players = listYesterdayRecapPlayers("c1", "2026-05-20");
    expect(players).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: bounded by toHaveLength above
    expect(players[0]!.history.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: same
    const diff = players[0]!.history[0] as unknown as Record<string, unknown>;
    expect(diff.marker).toBe("from-userday");
  });

  it("prefers channel_daily_participant.guesses_json when it's populated", () => {
    upsertParticipant({
      channelId: "c1",
      puzzleId: "2026-05-20",
      userId: "current",
      displayName: "Current",
    });
    const channelHistory = JSON.stringify([{ talentId: "t-x", marker: "from-channel" }]);
    getDb()
      .prepare(
        `UPDATE channel_daily_participant
            SET status='won', guesses_used=3, guesses_json=?
          WHERE user_id='current'`,
      )
      .run(channelHistory);
    // user_day has stale/conflicting data for the same day; should be ignored.
    const dayIndex = dayIndexForPuzzleId("2026-05-20");
    getDb()
      .prepare(
        `INSERT INTO user_day (user_id, day_index, guesses_json, status, updated_at)
         VALUES (?, ?, ?, ?, strftime('%s','now'))`,
      )
      .run("current", dayIndex, JSON.stringify([{ talentId: "z", marker: "stale" }]), "won");

    const players = listYesterdayRecapPlayers("c1", "2026-05-20");
    expect(players).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: bounded
    const diff = players[0]!.history[0] as unknown as Record<string, unknown>;
    expect(diff.marker).toBe("from-channel");
  });
});
