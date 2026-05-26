import { boardRowFromDiff, type GuessDiff, type PlayerSnapshot } from "@holodle/shared";
import { getDb } from "../db/client.js";
import { patchFollowup, postFollowup } from "../discord/followups.js";
import {
  buildNowPlayingEmbed,
  buildSupersededContent,
  buildYesterdayRecapEmbed,
  type NowPlayingParticipant,
  type RecapPlayer,
} from "../discord/embeds.js";

// Staleness thresholds. If either is exceeded when we go to PATCH the
// existing "Now Playing" message, we instead supersede: PATCH the old to
// past-tense and POST a brand new message as a reply.
const STALE_AGE_SEC = 60 * 60; // original message older than 1h
const STALE_IDLE_SEC = 30 * 60; // last edit older than 30min

// Interaction tokens are valid for 15 minutes from issuance. We persist
// the absolute expiry so we never have to remember "when was this issued".
const TOKEN_TTL_SEC = 15 * 60;

export interface ChannelDailyState {
  channelId: string;
  puzzleId: string;
  messageId: string | null;
  // Epoch seconds when message_id was first written + last edited. NULL on
  // freshly-created rows that haven't been posted yet.
  messageCreatedAt: number | null;
  messageUpdatedAt: number | null;
  latestToken: string;
  latestTokenAppId: string;
  latestTokenExp: number;
}

interface StateRow {
  channel_id: string;
  puzzle_id: string;
  message_id: string | null;
  message_created_at: number | null;
  message_updated_at: number | null;
  latest_token: string;
  latest_token_app_id: string;
  latest_token_exp: number;
}

const STATE_COLUMNS =
  "channel_id, puzzle_id, message_id, message_created_at, message_updated_at, " +
  "latest_token, latest_token_app_id, latest_token_exp";

function rowToState(row: StateRow): ChannelDailyState {
  return {
    channelId: row.channel_id,
    puzzleId: row.puzzle_id,
    messageId: row.message_id,
    messageCreatedAt: row.message_created_at,
    messageUpdatedAt: row.message_updated_at,
    latestToken: row.latest_token,
    latestTokenAppId: row.latest_token_app_id,
    latestTokenExp: row.latest_token_exp,
  };
}

export function getChannelState(
  channelId: string,
  puzzleId: string,
): ChannelDailyState | null {
  const row = getDb()
    .prepare(
      `SELECT ${STATE_COLUMNS}
         FROM channel_daily_state WHERE channel_id = ? AND puzzle_id = ?`,
    )
    .get(channelId, puzzleId) as StateRow | undefined;
  return row ? rowToState(row) : null;
}

// True when the existing message has been around long enough that we want
// to post a fresh one (as a reply) instead of editing in place. Either
// of two thresholds tips it: total age, or time since last edit.
export function isStaleMessage(
  state: ChannelDailyState,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!state.messageId) return false;
  if (state.messageCreatedAt !== null && nowSec - state.messageCreatedAt > STALE_AGE_SEC) {
    return true;
  }
  if (state.messageUpdatedAt !== null && nowSec - state.messageUpdatedAt > STALE_IDLE_SEC) {
    return true;
  }
  return false;
}

// Refresh (or create) the row's freshest token. messageId is preserved if
// already set. Returns the resulting state.
export function upsertChannelToken(
  channelId: string,
  puzzleId: string,
  token: string,
  appId: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): ChannelDailyState {
  getDb()
    .prepare(
      `INSERT INTO channel_daily_state
         (channel_id, puzzle_id, message_id, latest_token, latest_token_app_id, latest_token_exp)
       VALUES (?, ?, NULL, ?, ?, ?)
       ON CONFLICT(channel_id, puzzle_id) DO UPDATE SET
         latest_token         = excluded.latest_token,
         latest_token_app_id  = excluded.latest_token_app_id,
         latest_token_exp     = excluded.latest_token_exp`,
    )
    .run(channelId, puzzleId, token, appId, nowSec + TOKEN_TTL_SEC);
  // biome-ignore lint/style/noNonNullAssertion: row is guaranteed to exist after upsert
  return getChannelState(channelId, puzzleId)!;
}

// Called once after a successful POST. Stamps both timestamps to "now" so
// the staleness checks have a baseline; subsequent PATCHes only bump
// message_updated_at via markChannelMessageUpdated.
export function setChannelMessageId(
  channelId: string,
  puzzleId: string,
  messageId: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): void {
  getDb()
    .prepare(
      `UPDATE channel_daily_state
          SET message_id = ?, message_created_at = ?, message_updated_at = ?
        WHERE channel_id = ? AND puzzle_id = ?`,
    )
    .run(messageId, nowSec, nowSec, channelId, puzzleId);
}

// Bumps message_updated_at after a successful PATCH. Called by the embed
// patch path so the 30-min idle threshold resets on every live edit.
export function markChannelMessageUpdated(
  channelId: string,
  puzzleId: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): void {
  getDb()
    .prepare(
      `UPDATE channel_daily_state
          SET message_updated_at = ?
        WHERE channel_id = ? AND puzzle_id = ?`,
    )
    .run(nowSec, channelId, puzzleId);
}

// Called when the existing message is superseded by a freshly-posted one.
// Clears message_id (and timestamps) so the next post path treats this
// puzzle as "no message yet" and posts new (with a message_reference back
// to the old, just-PATCHed message).
export function clearChannelMessage(channelId: string, puzzleId: string): void {
  getDb()
    .prepare(
      `UPDATE channel_daily_state
          SET message_id = NULL, message_created_at = NULL, message_updated_at = NULL
        WHERE channel_id = ? AND puzzle_id = ?`,
    )
    .run(channelId, puzzleId);
}

// Find ANY state row for this channel whose latest token is still fresh —
// even one from a different puzzle. Used to bootstrap a new embed when a
// user crosses their local midnight without re-/launching: the day-1 token
// is still valid (15 min) and can be re-used to post a day-2 embed.
export function findFreshChannelToken(
  channelId: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): { token: string; appId: string; exp: number } | null {
  const row = getDb()
    .prepare(
      `SELECT latest_token, latest_token_app_id, latest_token_exp
         FROM channel_daily_state
        WHERE channel_id = ? AND latest_token_exp > ?
        ORDER BY latest_token_exp DESC LIMIT 1`,
    )
    .get(channelId, nowSec) as
    | { latest_token: string; latest_token_app_id: string; latest_token_exp: number }
    | undefined;
  if (!row) return null;
  return {
    token: row.latest_token,
    appId: row.latest_token_app_id,
    exp: row.latest_token_exp,
  };
}

export function tryClaimRecapPosted(channelId: string, puzzleId: string): boolean {
  const result = getDb()
    .prepare(
      `INSERT INTO channel_recap_posted (channel_id, puzzle_id) VALUES (?, ?)
       ON CONFLICT (channel_id, puzzle_id) DO NOTHING`,
    )
    .run(channelId, puzzleId);
  return result.changes === 1;
}

export function isRecapPosted(channelId: string, puzzleId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM channel_recap_posted WHERE channel_id = ? AND puzzle_id = ?`,
    )
    .get(channelId, puzzleId);
  return !!row;
}

export interface UpsertParticipantInput {
  channelId: string;
  puzzleId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}

// Idempotent. Seeds (or refreshes) the channel row from the user's most
// recent user_day so the embed grid reflects any guesses they made before
// this channel ever existed for them — e.g. a user who completed today's
// puzzle in a different channel (or before the image-embed code shipped)
// still gets their board rendered on /launch here. recordParticipantProgress
// keeps things in sync for every guess after launch.
export function upsertParticipant({
  channelId,
  puzzleId,
  userId,
  displayName,
  avatarUrl,
}: UpsertParticipantInput): void {
  const progress = findRecentUserDayProgress(userId);
  const guessesJson = progress ? JSON.stringify(progress.history) : "[]";
  const guessesUsed = progress ? progress.history.length : 0;
  const status = progress ? progress.status : "playing";

  // On CONFLICT, only backfill progress when the existing channel row has
  // none and user_day has some. That preserves any in-channel progress
  // recordParticipantProgress has already written, while still healing rows
  // that pre-date this channel for the user.
  getDb()
    .prepare(
      `INSERT INTO channel_daily_participant
         (channel_id, puzzle_id, user_id, display_name, avatar_url, guesses_used, guesses_json, status, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
       ON CONFLICT(channel_id, puzzle_id, user_id) DO UPDATE SET
         display_name = excluded.display_name,
         avatar_url   = COALESCE(excluded.avatar_url, channel_daily_participant.avatar_url),
         guesses_used = CASE
           WHEN channel_daily_participant.guesses_used = 0 AND excluded.guesses_used > 0
           THEN excluded.guesses_used ELSE channel_daily_participant.guesses_used
         END,
         guesses_json = CASE
           WHEN channel_daily_participant.guesses_used = 0 AND excluded.guesses_used > 0
           THEN excluded.guesses_json ELSE channel_daily_participant.guesses_json
         END,
         status = CASE
           WHEN channel_daily_participant.guesses_used = 0 AND excluded.guesses_used > 0
           THEN excluded.status ELSE channel_daily_participant.status
         END`,
    )
    .run(
      channelId,
      puzzleId,
      userId,
      displayName,
      avatarUrl ?? null,
      guessesUsed,
      guessesJson,
      status,
    );
}

// Latest user_day row for `userId` whose updated_at is within the trailing
// 36h window — wide enough to cover any timezone's "today" relative to the
// channel's UTC puzzle, narrow enough that yesterday's settled board stops
// showing up on the embed once today's puzzle has rolled over everywhere.
// Returns null when no recent progress exists (fresh participant).
function findRecentUserDayProgress(
  userId: string,
): { history: GuessDiff[]; status: "playing" | "won" | "lost" } | null {
  const row = getDb()
    .prepare(
      `SELECT guesses_json, status FROM user_day
         WHERE user_id = ?
           AND updated_at > strftime('%s','now') - 129600
         ORDER BY updated_at DESC
         LIMIT 1`,
    )
    .get(userId) as { guesses_json: string; status: "playing" | "won" | "lost" } | undefined;
  if (!row) return null;
  const history = parseGuesses(row.guesses_json);
  if (history.length === 0 && row.status === "playing") return null;
  return { history, status: row.status };
}

export function listParticipants(
  channelId: string,
  puzzleId: string,
): NowPlayingParticipant[] {
  const rows = getDb()
    .prepare(
      `SELECT user_id, display_name, avatar_url, guesses_used, guesses_json, status
         FROM channel_daily_participant
        WHERE channel_id = ? AND puzzle_id = ?
        ORDER BY joined_at ASC`,
    )
    .all(channelId, puzzleId) as Array<{
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    guesses_used: number;
    guesses_json: string;
    status: "playing" | "won" | "lost";
  }>;
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    guessesUsed: r.guesses_used,
    history: parseGuesses(r.guesses_json),
    status: r.status,
  }));
}

function parseGuesses(json: string): GuessDiff[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as GuessDiff[]) : [];
  } catch {
    return [];
  }
}

// Returns the most-recent puzzle_id in this channel that has settled
// (won/lost) plays AND hasn't been recapped yet AND is strictly older than
// `todayPuzzleId`. Used by /launch to post the recap for "the previous
// session in this channel" — not strictly literal "yesterday" — so a gap
// of inactive days doesn't make the recap silently disappear. Returns
// null when no eligible puzzle exists.
export function findMostRecentUnpostedRecapPuzzle(
  channelId: string,
  todayPuzzleId: string,
): string | null {
  const row = getDb()
    .prepare(
      `SELECT puzzle_id FROM channel_daily_participant
        WHERE channel_id = ?
          AND status IN ('won','lost')
          AND puzzle_id < ?
          AND puzzle_id NOT IN (
            SELECT puzzle_id FROM channel_recap_posted WHERE channel_id = ?
          )
        ORDER BY puzzle_id DESC LIMIT 1`,
    )
    .get(channelId, todayPuzzleId, channelId) as { puzzle_id: string } | undefined;
  return row?.puzzle_id ?? null;
}

export function listYesterdayRecapPlayers(
  channelId: string,
  puzzleId: string,
): RecapPlayer[] {
  const rows = getDb()
    .prepare(
      `SELECT user_id, display_name, avatar_url, guesses_used, guesses_json, status
         FROM channel_daily_participant
        WHERE channel_id = ?
          AND puzzle_id  = ?
          AND status IN ('won','lost')
        ORDER BY guesses_used ASC`,
    )
    .all(channelId, puzzleId) as Array<{
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    guesses_used: number;
    guesses_json: string;
    status: "won" | "lost";
  }>;
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    guessesUsed: r.guesses_used,
    history: parseGuesses(r.guesses_json),
    status: r.status,
  }));
}

// Drives the embed-write side of every guess + every /launch click.
// Builds the participants snapshot, decides whether to PATCH the existing
// "Now Playing" message, supersede it with a fresh reply, or POST a new
// one outright. Safe to call without a fresh interaction token — falls back
// to a borrowed token from another puzzle row when this puzzle has none.
//
// `displayName` is used only to upsert the participant row if it doesn't
// exist yet (e.g. cross-day mid-game). Pass the current player's name.
export async function syncChannelEmbed(
  channelId: string,
  puzzleId: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  let state = getChannelState(channelId, puzzleId);

  // No row for this puzzle — bootstrap one with a borrowed fresh token if
  // any exists for this channel (e.g. user crossed local midnight without
  // anyone re-/launching).
  if (!state) {
    const fresh = findFreshChannelToken(channelId, nowSec);
    if (!fresh) return; // nothing we can do without a valid token
    state = upsertChannelToken(channelId, puzzleId, fresh.token, fresh.appId, nowSec);
  }

  if (state.latestTokenExp <= nowSec) return; // token expired — no-op

  const participants = listParticipants(channelId, puzzleId);
  const { embed, components, file } = await buildNowPlayingEmbed({
    puzzleId,
    participants,
    applicationId: state.latestTokenAppId,
  });

  // No message yet for this puzzle → POST a new one (no reply context).
  if (!state.messageId) {
    try {
      const posted = await postFollowup(
        state.latestTokenAppId,
        state.latestToken,
        { embeds: [embed], components, files: [file] },
        { wait: true },
      );
      if (posted) setChannelMessageId(channelId, puzzleId, posted.id, nowSec);
    } catch (err) {
      console.error("[channelState] syncChannelEmbed post failed:", err);
    }
    return;
  }

  // Message exists but it's been around too long — finalize it as a
  // "X was playing" snapshot and post a fresh one as a reply.
  if (isStaleMessage(state, nowSec)) {
    const oldMessageId = state.messageId;
    const supersededContent = buildSupersededContent(participants);
    try {
      // PATCH the old message: past-tense content, drop the "Play now!"
      // button (clicking it would now hit the new message's flow anyway,
      // but visually the old one shouldn't invite new clicks).
      await patchFollowup(state.latestTokenAppId, state.latestToken, oldMessageId, {
        content: supersededContent,
        embeds: [embed],
        components: [],
        files: [file],
      });
    } catch (err) {
      console.error("[channelState] syncChannelEmbed supersede-patch failed:", err);
    }
    // Even if the patch failed, proceed to post the new message — losing
    // both is worse than the old one keeping its old text.
    try {
      const posted = await postFollowup(
        state.latestTokenAppId,
        state.latestToken,
        {
          embeds: [embed],
          components,
          files: [file],
          message_reference: { message_id: oldMessageId, fail_if_not_exists: false },
        },
        { wait: true },
      );
      if (posted) {
        clearChannelMessage(channelId, puzzleId);
        setChannelMessageId(channelId, puzzleId, posted.id, nowSec);
      }
    } catch (err) {
      console.error("[channelState] syncChannelEmbed supersede-post failed:", err);
    }
    return;
  }

  // Normal in-place edit.
  try {
    const ok = await patchFollowup(state.latestTokenAppId, state.latestToken, state.messageId, {
      embeds: [embed],
      components,
      files: [file],
    });
    if (ok) markChannelMessageUpdated(channelId, puzzleId, nowSec);
  } catch (err) {
    console.error("[channelState] syncChannelEmbed patch failed:", err);
  }
}

// Called from the guess route on EVERY guess. Persists the running history
// against channel_daily_participant, then defers the embed write to
// syncChannelEmbed.
export async function recordParticipantProgress(
  userId: string,
  channelId: string,
  puzzleId: string,
  displayName: string,
  history: GuessDiff[],
  status: "playing" | "won" | "lost",
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  // Make sure the participant row exists — upsertParticipant is idempotent
  // and will backfill from user_day. The user may be playing a puzzle in
  // this channel that they never explicitly /launched (e.g. they crossed
  // midnight mid-game).
  upsertParticipant({ channelId, puzzleId, userId, displayName });

  const guessesUsed = history.length;
  const guessesJson = JSON.stringify(history);
  getDb()
    .prepare(
      `UPDATE channel_daily_participant
          SET guesses_used = ?, guesses_json = ?, status = ?
        WHERE channel_id = ? AND puzzle_id = ? AND user_id = ?`,
    )
    .run(guessesUsed, guessesJson, status, channelId, puzzleId, userId);

  await syncChannelEmbed(channelId, puzzleId, nowSec);
}

// Used by the boards panel: every channel participant for this puzzle,
// joined with their stored guess colors. `dayIndex` is derived from the
// viewer's puzzleId by the caller (1:1 with puzzleId via dailyPicker), so
// we can look each participant's row up directly.
export function loadChannelBoards(
  channelId: string,
  puzzleId: string,
  dayIndex: number,
): PlayerSnapshot[] {
  const rows = getDb()
    .prepare(
      `SELECT p.user_id,
              p.display_name,
              p.guesses_used,
              p.status,
              u.guesses_json
         FROM channel_daily_participant p
         LEFT JOIN user_day u
                ON u.user_id = p.user_id
               AND u.day_index = ?
        WHERE p.channel_id = ? AND p.puzzle_id = ?
        ORDER BY p.joined_at ASC`,
    )
    .all(dayIndex, channelId, puzzleId) as Array<{
    user_id: string;
    display_name: string;
    guesses_used: number;
    status: "playing" | "won" | "lost";
    guesses_json: string | null;
  }>;
  return rows.map((r) => {
    let board: ReturnType<typeof boardRowFromDiff>[] = [];
    if (r.guesses_json) {
      try {
        const diffs = JSON.parse(r.guesses_json) as GuessDiff[];
        board = diffs.map(boardRowFromDiff);
      } catch {
        board = [];
      }
    }
    return {
      userId: r.user_id,
      displayName: r.display_name,
      // We never persist avatarUrl in channel_daily_participant — those come
      // from the live socket payload when the user actually connects.
      avatarUrl: null,
      guessesUsed: r.guesses_used,
      status: r.status,
      board,
    };
  });
}

// Helpers re-exported for the interactions route — keeps that file focused
// on orchestration.
export { buildNowPlayingEmbed, buildYesterdayRecapEmbed };
export { postFollowup };
