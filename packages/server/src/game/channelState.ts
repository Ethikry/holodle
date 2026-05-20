import type { GuessDiff } from "@holodle/shared";
import { getDb } from "../db/client.js";
import { patchFollowup, postFollowup } from "../discord/followups.js";
import {
  buildNowPlayingEmbed,
  buildYesterdayRecapEmbed,
  type NowPlayingParticipant,
  type RecapPlayer,
} from "../discord/embeds.js";

// Interaction tokens are valid for 15 minutes from issuance. We persist
// the absolute expiry so we never have to remember "when was this issued".
const TOKEN_TTL_SEC = 15 * 60;

export interface ChannelDailyState {
  channelId: string;
  puzzleId: string;
  messageId: string | null;
  latestToken: string;
  latestTokenAppId: string;
  latestTokenExp: number;
}

interface StateRow {
  channel_id: string;
  puzzle_id: string;
  message_id: string | null;
  latest_token: string;
  latest_token_app_id: string;
  latest_token_exp: number;
}

export function getChannelState(
  channelId: string,
  puzzleId: string,
): ChannelDailyState | null {
  const row = getDb()
    .prepare(
      `SELECT channel_id, puzzle_id, message_id, latest_token, latest_token_app_id, latest_token_exp
         FROM channel_daily_state WHERE channel_id = ? AND puzzle_id = ?`,
    )
    .get(channelId, puzzleId) as StateRow | undefined;
  if (!row) return null;
  return {
    channelId: row.channel_id,
    puzzleId: row.puzzle_id,
    messageId: row.message_id,
    latestToken: row.latest_token,
    latestTokenAppId: row.latest_token_app_id,
    latestTokenExp: row.latest_token_exp,
  };
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

export function setChannelMessageId(
  channelId: string,
  puzzleId: string,
  messageId: string,
): void {
  getDb()
    .prepare(
      `UPDATE channel_daily_state SET message_id = ? WHERE channel_id = ? AND puzzle_id = ?`,
    )
    .run(messageId, channelId, puzzleId);
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

// Idempotent. If the participant already exists, display_name + avatar_url
// are refreshed (both can change between launches); guesses_used/status are
// preserved so a re-launch never clobbers an in-progress count.
export function upsertParticipant({
  channelId,
  puzzleId,
  userId,
  displayName,
  avatarUrl,
}: UpsertParticipantInput): void {
  getDb()
    .prepare(
      `INSERT INTO channel_daily_participant
         (channel_id, puzzle_id, user_id, display_name, avatar_url, guesses_used, guesses_json, status, joined_at)
       VALUES (?, ?, ?, ?, ?, 0, '[]', 'playing', strftime('%s','now'))
       ON CONFLICT(channel_id, puzzle_id, user_id) DO UPDATE SET
         display_name = excluded.display_name,
         avatar_url   = COALESCE(excluded.avatar_url, channel_daily_participant.avatar_url)`,
    )
    .run(channelId, puzzleId, userId, displayName, avatarUrl ?? null);
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

// Called from the guess route on *every* guess. Persists the running history
// and — if we still hold a fresh interaction token for this channel-day —
// patches the now-playing message in place so the embed image reflects the
// new row. Skipping the patch on missing message_id / expired token is the
// expected case for participants who never launched (they have a user_day
// row but no channel embed to update).
export async function recordParticipantProgress(
  userId: string,
  channelId: string,
  puzzleId: string,
  history: GuessDiff[],
  status: "playing" | "won" | "lost",
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  const guessesUsed = history.length;
  const guessesJson = JSON.stringify(history);
  getDb()
    .prepare(
      `UPDATE channel_daily_participant
          SET guesses_used = ?, guesses_json = ?, status = ?
        WHERE channel_id = ? AND puzzle_id = ? AND user_id = ?`,
    )
    .run(guessesUsed, guessesJson, status, channelId, puzzleId, userId);

  const state = getChannelState(channelId, puzzleId);
  if (!state || !state.messageId) return;
  if (state.latestTokenExp <= nowSec) return; // token expired — no-op
  const participants = listParticipants(channelId, puzzleId);
  const { embed, components, file } = await buildNowPlayingEmbed({
    puzzleId,
    participants,
    applicationId: state.latestTokenAppId,
  });
  try {
    await patchFollowup(state.latestTokenAppId, state.latestToken, state.messageId, {
      embeds: [embed],
      components,
      files: [file],
    });
  } catch (err) {
    console.error("[channelState] recordParticipantProgress patch failed:", err);
  }
}

// Back-compat alias for the old "settled only" signature. The new flow calls
// recordParticipantProgress on every guess; this is kept for any caller that
// only knows the final status + count.
export async function recordCompletion(
  userId: string,
  channelId: string,
  puzzleId: string,
  guessesUsed: number,
  status: "won" | "lost",
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  // Update terminal status; leave guesses_json untouched (already written by
  // the latest recordParticipantProgress on that user's previous guess).
  getDb()
    .prepare(
      `UPDATE channel_daily_participant
          SET guesses_used = ?, status = ?
        WHERE channel_id = ? AND puzzle_id = ? AND user_id = ?`,
    )
    .run(guessesUsed, status, channelId, puzzleId, userId);

  const state = getChannelState(channelId, puzzleId);
  if (!state || !state.messageId) return;
  if (state.latestTokenExp <= nowSec) return;
  const participants = listParticipants(channelId, puzzleId);
  const { embed, components, file } = await buildNowPlayingEmbed({
    puzzleId,
    participants,
    applicationId: state.latestTokenAppId,
  });
  try {
    await patchFollowup(state.latestTokenAppId, state.latestToken, state.messageId, {
      embeds: [embed],
      components,
      files: [file],
    });
  } catch (err) {
    console.error("[channelState] recordCompletion patch failed:", err);
  }
}

// Helpers re-exported for the interactions route — keeps that file focused
// on orchestration.
export { buildNowPlayingEmbed, buildYesterdayRecapEmbed };
export { postFollowup };
