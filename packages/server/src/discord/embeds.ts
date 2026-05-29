// --- packages/server/src/discord/embeds.ts ---

import type { GuessDiff } from "@holodle/shared";
import {
  renderNowPlayingImage,
  type NowPlayingImageParticipant,
} from "./imageRender.js";
import type { FollowupFile } from "./followups.js";
import { displayPuzzleNumberForPuzzleId } from "../game/dailyPicker.js";

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title?: string;
  description?: string;
  color?: number;
  image?: { url: string };
  thumbnail?: { url: string };
  footer?: { text: string };
  fields?: EmbedField[];
}

export interface LinkButton {
  type: 2;
  style: 5; // LINK
  label: string;
  url: string;
}

export interface PrimaryButton {
  type: 2;
  style: 1; // PRIMARY (blurple)
  label: string;
  custom_id: string;
}

export type ButtonComponent = LinkButton | PrimaryButton;

export interface ActionRow {
  type: 1;
  components: ButtonComponent[];
}

export type MessageComponent = ActionRow;

const COLOR_RECAP = 0x22b8e6;

// Embed Side-Bar Color Constants
export const COLOR_STALE = 0x7f8c8d;   // Gray when stale/superseded
export const COLOR_BLUE = 0x22b8e6;    // Sky blue when active with no players yet
export const COLOR_GREEN = 0x3aa55d;   // Green when active and someone is playing

const NOW_PLAYING_FILENAME = "holodle-now-playing.png";
const RECAP_FILENAME = "holodle-recap.png";

export interface NowPlayingParticipant {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  guessesUsed: number;
  history: GuessDiff[];
  status: "playing" | "won" | "lost";
}

export interface NowPlayingInput {
  puzzleId: string;
  participants: NowPlayingParticipant[];
  applicationId: string;
  isStale?: boolean; // <-- Added optional staleness flag
}

export interface RenderedMessage {
  embed: Embed;
  components: MessageComponent[];
  file: FollowupFile;
}

export async function buildNowPlayingEmbed({
  puzzleId,
  participants,
  isStale = false, // Default to active/non-stale
}: NowPlayingInput): Promise<RenderedMessage> {
  const imageParticipants: NowPlayingImageParticipant[] = participants.map((p) => ({
    avatarUrl: p.avatarUrl,
    history: p.history,
    status: p.status,
  }));
  const puzzleNumber = displayPuzzleNumberForPuzzleId(puzzleId);
  const png = await renderNowPlayingImage({
    puzzleId,
    puzzleNumber,
    participants: imageParticipants,
  });

  // Dynamically assign sidebar color based on criteria
  let sidebarColor = COLOR_BLUE;
  if (isStale) {
    sidebarColor = COLOR_STALE;
  } else if (participants.length > 0) {
    sidebarColor = COLOR_GREEN;
  }

  const embed: Embed = {
    color: sidebarColor,
    image: { url: `attachment://${NOW_PLAYING_FILENAME}` },
  };

  // Primary (blurple) button. Click → MESSAGE_COMPONENT interaction with
  // custom_id "launch" → server responds with LAUNCH_ACTIVITY (type 12).
  // Link buttons (style 5) can't be colored; primary + LAUNCH_ACTIVITY is
  // the only way to get a blue "Play now!" button.
  const button: PrimaryButton = {
    type: 2,
    style: 1,
    label: "Play now!",
    custom_id: LAUNCH_BUTTON_CUSTOM_ID,
  };
  const components: MessageComponent[] = [{ type: 1, components: [button] }];

  return {
    embed,
    components,
    file: { filename: NOW_PLAYING_FILENAME, data: png, contentType: "image/png" },
  };
}

export const LAUNCH_BUTTON_CUSTOM_ID = "launch";

// Past-tense subtitle for a "Now Playing" message that's just been
// superseded by a fresher one. Mirrors Wordle's "X and N others were
// playing" / "X was playing" pattern.
export function buildSupersededContent(participants: NowPlayingParticipant[]): string {
  if (participants.length === 0) return "No one was playing";
  // Sort by joined order (already the case from listParticipants), but
  // promote the most-progressed player to first so the subtitle leads with
  // whoever was actually doing something.
  const sorted = [...participants].sort((a, b) => b.guessesUsed - a.guessesUsed);
  // biome-ignore lint/style/noNonNullAssertion: bounded by length check above
  const first = sorted[0]!;
  if (sorted.length === 1) return `${first.displayName} was playing`;
  if (sorted.length === 2) {
    // biome-ignore lint/style/noNonNullAssertion: bounded by length check above
    return `${first.displayName} and ${sorted[1]!.displayName} were playing`;
  }
  return `${first.displayName} and ${sorted.length - 1} others were playing`;
}

export interface RecapPlayer {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  guessesUsed: number;
  history: GuessDiff[];
  status: "won" | "lost";
}

export interface RecapEmbedInput {
  puzzleId: string;
  players: RecapPlayer[];
  // Channel streak count (consecutive days with settled plays through
  // puzzleId, inclusive). 0 or omitted → streak line is skipped.
  streak?: number;
  // Maximum guesses allowed per puzzle — used to format the loss bucket
  // (e.g. "X/6"). Defaults to 6 if omitted.
  maxGuesses?: number;
  answerName?: string | null;
  // Users who opted out of being rendered as a `<@id>` mention chip. Their
  // line appears with their displayName as plain text instead.
  mutedUserIds?: ReadonlySet<string>;
}

export interface RenderedRecap {
  embed: Embed;
  file: FollowupFile;
  // Plain-text message body posted above the image. Includes the streak
  // line + grouped mentions by score. Recipients are mentioned by id but
  // we suppress notifications via allowed_mentions on the wire.
  content: string;
  // Same blue "Play now!" button shape the Now Playing embed carries.
  // Clicking it routes through the existing LAUNCH_BUTTON_CUSTOM_ID
  // handler in interactions.ts (no new wiring required).
  components: MessageComponent[];
}

const CROWN_EMOJI = "👑";

// Defangs a user-controlled display name so it can't render as a different
// mention or markdown link when emitted as plain text in the recap. We
// only escape the characters Discord parses as the START of a mention or
// channel link — `@`, `#`, `<` — and leave everything else alone so the
// name stays human-readable. Zero-width spaces are sufficient to break
// the parser without visibly distorting the name.
const ZERO_WIDTH = "​";
export function escapeDiscordMention(name: string): string {
  return name.replace(/[@#<]/g, (c) => `${ZERO_WIDTH}${c}`);
}

function streakFlames(streak: number): string {
  if (streak >= 100) return "🔥🔥🔥";
  if (streak >= 10) return "🔥🔥";
  return "🔥";
}

// Builds the Wordle-style header: optional streak line + intro, then one
// line per (guesses-used) bucket. Lowest-guess winners get the 👑 prefix;
// losses go under "X/N:". Users whose `userId` appears in `mutedUserIds`
// render as their plain (escaped) displayName instead of a `<@id>` chip —
// the opt-out path for the in-app "show me as a mention chip" toggle.
function buildRecapContent(
  players: RecapPlayer[],
  puzzleId: string,
  streak: number,
  maxGuesses: number,
  mutedUserIds: ReadonlySet<string> = new Set(),
): string {
  const renderMention = (p: RecapPlayer): string =>
    mutedUserIds.has(p.userId)
      ? escapeDiscordMention(p.displayName)
      : `<@${p.userId}>`;
  const puzzleNumber = displayPuzzleNumberForPuzzleId(puzzleId);
  const lines: string[] = [];

  if (streak > 0) {
    lines.push(
      `Your channel is on a **${streak}-day streak!** ${streakFlames(streak)} Here are the results for Holodle No. ${puzzleNumber}:`,
    );
  } else {
    lines.push(`Here are the results for Holodle No. ${puzzleNumber}:`);
  }

  // Group winners by guesses_used, losses by themselves.
  const wins = new Map<number, RecapPlayer[]>();
  const losses: RecapPlayer[] = [];
  for (const p of players) {
    if (p.status === "won") {
      const arr = wins.get(p.guessesUsed) ?? [];
      arr.push(p);
      wins.set(p.guessesUsed, arr);
    } else {
      losses.push(p);
    }
  }

  const sortedWinCounts = Array.from(wins.keys()).sort((a, b) => a - b);
  const lowestCount = sortedWinCounts[0];
  for (const count of sortedWinCounts) {
    const prefix = count === lowestCount ? `${CROWN_EMOJI} ` : "";
    const bucket = wins.get(count) ?? [];
    const mentions = bucket.map(renderMention).join(" ");
    lines.push(`${prefix}${count}/${maxGuesses}: ${mentions}`);
  }
  if (losses.length > 0) {
    const mentions = losses.map(renderMention).join(" ");
    lines.push(`X/${maxGuesses}: ${mentions}`);
  }

  return lines.join("\n");
}

export async function buildYesterdayRecapEmbed({
  puzzleId,
  players,
  streak = 0,
  maxGuesses = 6,
  answerName,
  mutedUserIds,
}: RecapEmbedInput): Promise<RenderedRecap> {
  // The recap now uses the same image renderer as Now Playing — players are
  // already settled (won/lost), so each tile shows their final board.
  const imageParticipants: NowPlayingImageParticipant[] = players.map((p) => ({
    avatarUrl: p.avatarUrl,
    history: p.history,
    status: p.status,
  }));
  const puzzleNumber = displayPuzzleNumberForPuzzleId(puzzleId);
  const png = await renderNowPlayingImage({
    puzzleId,
    puzzleNumber,
    participants: imageParticipants,
    // Belt-and-suspenders: the content text identifies this as a recap,
    // but we keep the in-image subtitle too in case the content gets
    // truncated or clients suppress it.
    subtitle: answerName ? `Answer: ${answerName}` : "Yesterday's results",
  });

  // Mirror the Now Playing button — same custom_id, same handler in
  // interactions.ts, so the recap card invites a fresh /launch.
  const button: PrimaryButton = {
    type: 2,
    style: 1,
    label: "Play now!",
    custom_id: LAUNCH_BUTTON_CUSTOM_ID,
  };
  const components: MessageComponent[] = [{ type: 1, components: [button] }];

  return {
    embed: {
      color: COLOR_RECAP,
      image: { url: `attachment://${RECAP_FILENAME}` },
    },
    file: { filename: RECAP_FILENAME, data: png, contentType: "image/png" },
    content: buildRecapContent(players, puzzleId, streak, maxGuesses, mutedUserIds),
    components,
  };
}

// Live subtitle text generator for active (non-stale) embeds
export function buildActiveContent(participants: NowPlayingParticipant[]): string {
  if (participants.length === 0) return "No one is playing yet";
  const sorted = [...participants].sort((a, b) => b.guessesUsed - a.guessesUsed);
  // biome-ignore lint/style/noNonNullAssertion: bounded by length check above
  const first = sorted[0]!;
  if (sorted.length === 1) return `${first.displayName} is currently playing`;
  if (sorted.length === 2) {
    // biome-ignore lint/style/noNonNullAssertion: bounded by length check above
    return `${first.displayName} and ${sorted[1]!.displayName} are currently playing`;
  }
  return `${first.displayName} and ${sorted.length - 1} others are currently playing`;
}