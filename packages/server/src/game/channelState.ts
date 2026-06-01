import { boardRowFromDiff, type GuessDiff, type PlayerSnapshot } from "@holodle/shared";
import { getDb } from "../db/client.js";
import { patchFollowup, postFollowup } from "../discord/followups.js";
import {
  buildNowPlayingEmbed,
  buildSupersededContent,
  buildActiveContent, // Imported our new active subtitle helper
  buildYesterdayRecapEmbed,
  buildPlayNowButtonRow,
  buildStaleEmbed,
  type NowPlayingParticipant,
  type RecapPlayer,
} from "../discord/embeds.js";
import {
  dayIndexForPuzzleId,
  prevPuzzleId,
  puzzleEndUtcSecs,
} from "./dailyPicker.js";

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
  // Monotonic wave counter (see schema). Advances on each supersede-post.
  currentGen: number;
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
  current_gen: number;
  latest_token: string;
  latest_token_app_id: string;
  latest_token_exp: number;
}

const STATE_COLUMNS =
  "channel_id, puzzle_id, message_id, message_created_at, message_updated_at, " +
  "current_gen, latest_token, latest_token_app_id, latest_token_exp";

function rowToState(row: StateRow): ChannelDailyState {
  return {
    channelId: row.channel_id,
    puzzleId: row.puzzle_id,
    messageId: row.message_id,
    messageCreatedAt: row.message_created_at,
    messageUpdatedAt: row.message_updated_at,
    currentGen: row.current_gen,
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
//
// Legacy rows: when message_id is set but both timestamps are NULL, the
// row predates the stale-supersede deploy and we have no way to know how
// old the message really is. Treat as stale so the next interaction
// supersedes it — better than leaving an indefinitely-old message
// patchable in place.
export function isStaleMessage(
  state: ChannelDailyState,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!state.messageId) return false;
  if (state.messageCreatedAt === null && state.messageUpdatedAt === null) {
    return true;
  }
  if (state.messageCreatedAt !== null && nowSec - state.messageCreatedAt > STALE_AGE_SEC) {
    return true;
  }
  if (state.messageUpdatedAt !== null && nowSec - state.messageUpdatedAt > STALE_IDLE_SEC) {
    return true;
  }
  return false;
}

// True when any participant in the given wave is still mid-game ('playing').
// Used to keep an embed alive past its time threshold — see isEmbedStale.
function waveHasActivePlayer(channelId: string, puzzleId: string, gen: number): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM channel_daily_participant
        WHERE channel_id = ? AND puzzle_id = ? AND gen = ? AND status = 'playing'
        LIMIT 1`,
    )
    .get(channelId, puzzleId, gen);
  return !!row;
}

// Participant-aware staleness. An embed is only "stale" (eligible to be
// grayed/superseded) when it is BOTH time-stale (isStaleMessage) AND has no
// current-wave player still mid-game. Keeping a live game's embed fresh means
// a player who started on it still finishes on it instead of having their
// final board spawned onto a brand-new embed.
export function isEmbedStale(
  state: ChannelDailyState,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!isStaleMessage(state, nowSec)) return false;
  return !waveHasActivePlayer(state.channelId, state.puzzleId, state.currentGen);
}

// The embed "wave" a participant joining right now belongs to. While the
// current message is live (or there's no message yet) that's the current
// gen; once it's gone stale, joiners belong to the NEXT wave — the one that
// gets posted on the next supersede. Stable across the whole stale window
// because current_gen only advances when a supersede actually posts. Uses
// the participant-aware staleness so a join while someone is still playing
// lands in the live wave rather than splitting off a new one.
export function activeGenForJoin(
  state: ChannelDailyState | null,
  nowSec: number = Math.floor(Date.now() / 1000),
): number {
  if (!state) return 0;
  if (state.messageId && isEmbedStale(state, nowSec)) return state.currentGen + 1;
  return state.currentGen;
}

// Advances the persisted wave counter after a supersede posts a fresh embed.
export function setChannelGen(channelId: string, puzzleId: string, gen: number): void {
  getDb()
    .prepare(
      `UPDATE channel_daily_state SET current_gen = ? WHERE channel_id = ? AND puzzle_id = ?`,
    )
    .run(gen, channelId, puzzleId);
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
  // IANA tz the user is playing from (typically from getLatestUserTz or the
  // tz query param on /api/guess). Persisted so the recap eligibility gate
  // can wait until this participant's local day rolls over. NULL/undefined
  // leaves the column unchanged on update; the recap gate treats unknown
  // tz as UTC-12.
  tz?: string | null;
  // Wall-clock used to decide which embed wave this join lands in. Defaults
  // to real time; recordParticipantProgress threads its own nowSec so the
  // gen it stamps matches the nowSec it later hands syncChannelEmbed.
  nowSec?: number;
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
  tz,
  nowSec,
}: UpsertParticipantInput): void {
  const progress = findRecentUserDayProgress(userId);
  const guessesJson = progress ? JSON.stringify(progress.history) : "[]";
  const guessesUsed = progress ? progress.history.length : 0;
  const status = progress ? progress.status : "playing";

  // The wave this join belongs to. While the live embed is fresh this is the
  // current gen (so an existing player re-stamps to the same value — a
  // no-op); once it's stale, the joiner — including the player whose guess
  // is about to supersede it — moves into the next wave so the fresh embed
  // renders the new group, not the whole day.
  const gen = activeGenForJoin(getChannelState(channelId, puzzleId), nowSec);

  // On CONFLICT, only backfill progress when the existing channel row has
  // none and user_day has some. That preserves any in-channel progress
  // recordParticipantProgress has already written, while still healing rows
  // that pre-date this channel for the user. The tz column follows the
  // same "only overwrite when fresher info arrives" rule — passing NULL
  // keeps whatever was there. gen always re-stamps to the active wave.
  getDb()
    .prepare(
      `INSERT INTO channel_daily_participant
         (channel_id, puzzle_id, user_id, display_name, avatar_url, guesses_used, guesses_json, status, joined_at, tz, gen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'), ?, ?)
       ON CONFLICT(channel_id, puzzle_id, user_id) DO UPDATE SET
         display_name = excluded.display_name,
         avatar_url   = COALESCE(excluded.avatar_url, channel_daily_participant.avatar_url),
         tz           = COALESCE(excluded.tz, channel_daily_participant.tz),
         gen          = excluded.gen,
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
      tz ?? null,
      gen,
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

// Participants of a single embed wave. `gen` scopes the result to one
// "Now Playing" message so a superseded embed keeps its frozen group and a
// freshly-posted one only shows the new wave (not every player of the day).
export function listParticipants(
  channelId: string,
  puzzleId: string,
  gen: number,
): NowPlayingParticipant[] {
  const rows = getDb()
    .prepare(
      `SELECT user_id, display_name, avatar_url, guesses_used, guesses_json, status
         FROM channel_daily_participant
        WHERE channel_id = ? AND puzzle_id = ? AND gen = ?
        ORDER BY joined_at ASC`,
    )
    .all(channelId, puzzleId, gen) as Array<{
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

// How far back (in days) a channel participant can have last played and
// still count as "recent" for the recap safety gate. Cross-tz neighbors are
// at most ~1 calendar day apart (UTC+14 → UTC-12), so 2 days gives margin
// while keeping a long-vanished member from blocking the recap forever.
const RECENT_TZ_WINDOW_DAYS = 2;

// Returns the most-recent puzzle_id in this channel that:
//   1) has at least one settled (won/lost) participant,
//   2) hasn't been recapped yet,
//   3) is strictly older than `todayPuzzleId`, AND
//   4) is "globally safe" to recap — the local day has rolled over past that
//      puzzle's end for EVERY recent channel participant (not just the ones
//      who played that exact puzzle): max(puzzleEndUtcSecs(puzzleId, tz)) over
//      all recent participants' timezones ≤ now. NULL tz → UTC-12.
//
// (4) is the fix for the "fires too early" bug: a lone early-tz (e.g. JP)
// player who happens to be the only one to have played a puzzle would
// otherwise trip the recap the instant THEIR midnight passes — mid-day for
// the rest of the channel. By gating on every recent member's timezone we
// hold the recap until the slowest of them has rolled over.
export function findMostRecentUnpostedRecapPuzzle(
  channelId: string,
  todayPuzzleId: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): string | null {
  // Candidate puzzles: older than today, not yet recapped, with ≥1 settled
  // play. (Staleness/tz gating is applied per-candidate below.)
  const candRows = getDb()
    .prepare(
      `SELECT DISTINCT puzzle_id FROM channel_daily_participant
        WHERE channel_id = ?
          AND puzzle_id < ?
          AND status IN ('won','lost')
          AND puzzle_id NOT IN (
            SELECT puzzle_id FROM channel_recap_posted WHERE channel_id = ?
          )`,
    )
    .all(channelId, todayPuzzleId, channelId) as Array<{ puzzle_id: string }>;
  if (candRows.length === 0) return null;

  const tzRowsBetween = getDb().prepare(
    `SELECT DISTINCT tz FROM channel_daily_participant
       WHERE channel_id = ? AND puzzle_id >= ? AND puzzle_id <= ?`,
  );

  // Newest candidate first; return the first one whose broadened safe-at has
  // passed.
  const sorted = candRows.map((r) => r.puzzle_id).sort().reverse();
  for (const puzzleId of sorted) {
    // Recent window: participants who played from (puzzleId − N days) through
    // today. Their timezones drive when `puzzleId` is safe to recap.
    let lower = puzzleId;
    for (let i = 0; i < RECENT_TZ_WINDOW_DAYS; i++) lower = prevPuzzleId(lower);
    const tzRows = tzRowsBetween.all(channelId, lower, todayPuzzleId) as Array<{
      tz: string | null;
    }>;
    let safeAt = 0;
    for (const { tz } of tzRows) {
      const s = puzzleEndUtcSecs(puzzleId, tz);
      if (s > safeAt) safeAt = s;
    }
    if (safeAt <= nowSec) return puzzleId;
  }
  return null;
}

export function listYesterdayRecapPlayers(
  channelId: string,
  puzzleId: string,
): RecapPlayer[] {
  // LEFT JOIN with user_day so we can backfill the board for legacy channel
  // rows where guesses_json was never populated (pre-#3 recordCompletion
  // didn't write diffs to channel_daily_participant — only status+count).
  // The dayIndex is derived from puzzle_id directly so we don't need the
  // launching user's tz.
  const dayIndex = dayIndexForPuzzleId(puzzleId);
  const rows = getDb()
    .prepare(
      `SELECT p.user_id, p.display_name, p.avatar_url,
              p.guesses_used, p.guesses_json AS channel_json, p.status,
              u.guesses_json AS userday_json
         FROM channel_daily_participant p
         LEFT JOIN user_day u
                ON u.user_id   = p.user_id
               AND u.day_index = ?
        WHERE p.channel_id = ?
          AND p.puzzle_id  = ?
          AND p.status IN ('won','lost')
        ORDER BY p.guesses_used ASC`,
    )
    .all(dayIndex, channelId, puzzleId) as Array<{
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    guesses_used: number;
    channel_json: string;
    userday_json: string | null;
    status: "won" | "lost";
  }>;
  return rows.map((r) => {
    const channelHistory = parseGuesses(r.channel_json);
    // Fall back to user_day only when the channel-side history is empty —
    // never override a populated channel-side row.
    const history =
      channelHistory.length === 0 && r.userday_json
        ? parseGuesses(r.userday_json)
        : channelHistory;
    return {
      userId: r.user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      guessesUsed: r.guesses_used,
      history,
      status: r.status,
    };
  });
}

// Consecutive calendar days, walking back from `throughPuzzleId`, on which
// at least one channel member settled (won or lost). The "streak" surfaced
// in the recap header. Returns 0 if throughPuzzleId itself has no settled
// plays.
export function computeChannelStreak(
  channelId: string,
  throughPuzzleId: string,
): number {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT puzzle_id FROM channel_daily_participant
        WHERE channel_id = ?
          AND status IN ('won','lost')
          AND puzzle_id <= ?`,
    )
    .all(channelId, throughPuzzleId) as Array<{ puzzle_id: string }>;
  const settled = new Set(rows.map((r) => r.puzzle_id));
  let streak = 0;
  let cursor = throughPuzzleId;
  // Bounded walk so a malformed puzzle_id can't infinite-loop.
  for (let i = 0; i < 10_000; i++) {
    if (!settled.has(cursor)) break;
    streak++;
    const prev = prevPuzzleId(cursor);
    if (prev === cursor) break;
    cursor = prev;
  }
  return streak;
}

// Drives the embed-write side of every guess + every /launch click.
// Builds the participants snapshot, decides whether to PATCH the existing
// "Now Playing" message, supersede it with a fresh reply, or POST a new
// one outright. Safe to call without a fresh interaction token — falls back
// to a borrowed token from another puzzle row when this puzzle has none.
//
// `allowSupersede` gates the stale → reply flow. We only want to post a
// brand-new channel message when something visible actually changed on
// someone's board — i.e. a /api/guess. /launch and "Play now!" clicks pass
// false so a passive "open the activity" action never clutters the channel
// with a fresh embed, even if the existing one is hours old; in that case
// we just PATCH in place (or no-op if nothing to update).
//
// `keepAlive` forces the in-place (non-stale) path even when the embed is
// time-stale. recordParticipantProgress sets it when the guessing player
// already belongs to the live wave, so the guess that SETTLES their game
// (which would otherwise flip the wave to "no active players" → stale) still
// lands on the embed they've been playing on, rather than spawning a fresh
// one.
export async function syncChannelEmbed(
  channelId: string,
  puzzleId: string,
  options: { allowSupersede?: boolean; keepAlive?: boolean } = {},
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  const allowSupersede = options.allowSupersede === true;
  const keepAlive = options.keepAlive === true;

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

  // An embed is only stale while no current-wave player is still mid-game
  // (isEmbedStale), and never on a keep-alive sync (the live player's own
  // settling guess).
  const stale =
    state.messageId !== null && !keepAlive && isEmbedStale(state, nowSec);

  // ── Stale path ─────────────────────────────────────────────────────────
  // The live message has aged out. Freeze it: gray the sidebar, switch to
  // past-tense text, but KEEP the Play-now button (bug 7) and the original
  // board image (no re-upload — we don't pass `files`). We intentionally do
  // NOT bump message_updated_at here, so the message stays "stale" and a
  // later guess can still supersede it. Then:
  //   - guess (allowSupersede): post a fresh embed for the NEXT wave.
  //   - passive launch: stop. The clicker was recorded in the next wave but
  //     is not added to this frozen embed (bug 1); their board appears when
  //     they actually guess.
  if (stale) {
    const oldMessageId = state.messageId as string;
    const frozen = listParticipants(channelId, puzzleId, state.currentGen);
    try {
      await patchFollowup(state.latestTokenAppId, state.latestToken, oldMessageId, {
        content: buildSupersededContent(frozen),
        embeds: [buildStaleEmbed()],
        components: buildPlayNowButtonRow(),
      });
    } catch (err) {
      console.error("[channelState] syncChannelEmbed supersede-patch failed:", err);
    }

    if (!allowSupersede) return; // passive launch — leave the frozen embed

    const newGen = state.currentGen + 1;
    const fresh = listParticipants(channelId, puzzleId, newGen);
    const { embed, components, file } = await buildNowPlayingEmbed({
      puzzleId,
      participants: fresh,
      applicationId: state.latestTokenAppId,
    });
    // Even if the patch above failed, post the fresh embed — losing both is
    // worse than a stale message keeping its old text.
    try {
      const posted = await postFollowup(
        state.latestTokenAppId,
        state.latestToken,
        {
          content: buildActiveContent(fresh),
          embeds: [embed],
          components,
          files: [file],
          message_reference: { message_id: oldMessageId, fail_if_not_exists: false },
        },
        { wait: true },
      );
      if (posted) {
        setChannelGen(channelId, puzzleId, newGen);
        setChannelMessageId(channelId, puzzleId, posted.id, nowSec);
      }
    } catch (err) {
      console.error("[channelState] syncChannelEmbed supersede-post failed:", err);
    }
    return;
  }

  // ── Live path ──────────────────────────────────────────────────────────
  // Render only the current wave.
  const participants = listParticipants(channelId, puzzleId, state.currentGen);
  const { embed, components, file } = await buildNowPlayingEmbed({
    puzzleId,
    participants,
    applicationId: state.latestTokenAppId,
  });
  const activeContent = buildActiveContent(participants);

  // No message yet for this puzzle → POST a new one (no reply context).
  if (!state.messageId) {
    try {
      const posted = await postFollowup(
        state.latestTokenAppId,
        state.latestToken,
        { content: activeContent, embeds: [embed], components, files: [file] },
        { wait: true },
      );
      if (posted) setChannelMessageId(channelId, puzzleId, posted.id, nowSec);
    } catch (err) {
      console.error("[channelState] syncChannelEmbed post failed:", err);
    }
    return;
  }

  // Normal in-place edit.
  try {
    const ok = await patchFollowup(state.latestTokenAppId, state.latestToken, state.messageId, {
      content: activeContent,
      embeds: [embed],
      components,
      files: [file],
    });
    if (ok) markChannelMessageUpdated(channelId, puzzleId, nowSec);
  } catch (err) {
    console.error("[channelState] syncChannelEmbed patch failed:", err);
  }
}

// Drives the embed-write side of every guess + every /launch click.
// Persists the running history against channel_daily_participant, then defers
// the embed write to syncChannelEmbed.
export async function recordParticipantProgress(
  userId: string,
  channelId: string,
  puzzleId: string,
  displayName: string,
  history: GuessDiff[],
  status: "playing" | "won" | "lost",
  nowSec: number = Math.floor(Date.now() / 1000),
  tz: string | null = null,
): Promise<void> {
  // Make sure the participant row exists — upsertParticipant is idempotent
  // and will backfill from user_day. The user may be playing a puzzle in
  // this channel that they never explicitly /launched (e.g. they crossed
  // midnight mid-game). tz threads through so the recap eligibility gate
  // sees the freshest known timezone for each participant. nowSec threads
  // through so the stamped gen matches the staleness decision syncChannelEmbed
  // makes below at the same instant.
  upsertParticipant({ channelId, puzzleId, userId, displayName, tz, nowSec });

  // Is this guesser already part of the live wave? upsertParticipant stamped
  // their gen just now: while they were still mid-game the embed wasn't stale
  // (isEmbedStale is playing-aware), so they kept the current gen. If so, the
  // guess we're about to record — even the one that settles their game — must
  // stay on this same embed (keepAlive), not flip it to "no active players"
  // and supersede.
  const postState = getChannelState(channelId, puzzleId);
  const keepAlive =
    postState !== null &&
    getParticipantGen(channelId, puzzleId, userId) === postState.currentGen;

  const guessesUsed = history.length;
  const guessesJson = JSON.stringify(history);
  getDb()
    .prepare(
      `UPDATE channel_daily_participant
          SET guesses_used = ?, guesses_json = ?, status = ?
        WHERE channel_id = ? AND puzzle_id = ? AND user_id = ?`,
    )
    .run(guessesUsed, guessesJson, status, channelId, puzzleId, userId);

  await syncChannelEmbed(channelId, puzzleId, { allowSupersede: true, keepAlive }, nowSec);
}

// The wave a participant is currently tagged to, or null if they have no row.
function getParticipantGen(
  channelId: string,
  puzzleId: string,
  userId: string,
): number | null {
  const row = getDb()
    .prepare(
      `SELECT gen FROM channel_daily_participant
        WHERE channel_id = ? AND puzzle_id = ? AND user_id = ?`,
    )
    .get(channelId, puzzleId, userId) as { gen: number } | undefined;
  return row ? row.gen : null;
}

// Used by the boards panel: every channel participant for this puzzle,
// joined with their stored guess colors. `dayIndex` is derived from the
// viewer's puzzleId by the caller (1:1 with puzzleId via dailyPicker), so
// we can look each participant's row up directly.
//
// avatar_url is read straight from channel_daily_participant (populated by
// upsertParticipant on /launch). guesses_json prefers the channel-side
// row but falls back to user_day for legacy participants whose channel
// json was never written by the pre-#3 recordCompletion path.
export function loadChannelBoards(
  channelId: string,
  puzzleId: string,
  dayIndex: number,
): PlayerSnapshot[] {
  const rows = getDb()
    .prepare(
      `SELECT p.user_id,
              p.display_name,
              p.avatar_url,
              p.guesses_used,
              p.status,
              p.guesses_json AS channel_json,
              u.guesses_json AS userday_json
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
    avatar_url: string | null;
    guesses_used: number;
    status: "playing" | "won" | "lost";
    channel_json: string | null;
    userday_json: string | null;
  }>;
  return rows.map((r) => {
    const channelDiffs = parseGuesses(r.channel_json ?? "[]");
    const diffs =
      channelDiffs.length === 0 && r.userday_json
        ? parseGuesses(r.userday_json)
        : channelDiffs;
    const board = diffs.map(boardRowFromDiff);
    return {
      userId: r.user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
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