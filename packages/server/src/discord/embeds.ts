// Embed + component builders for the user-install flow. The visible content
// of every bot-posted message is now a composited PNG (see imageRender.ts);
// the embed itself is minimal scaffolding so Discord renders the attached
// image inline. We intentionally duplicate the minimal types we need here
// rather than depending on a `discord.js` client — the only thing that ever
// consumes these is JSON.stringify into a webhook POST body.

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
const COLOR_PLAYING = 0x9333ea;

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
}

export interface RenderedMessage {
  embed: Embed;
  components: MessageComponent[];
  file: FollowupFile;
}

export async function buildNowPlayingEmbed({
  puzzleId,
  participants,
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

  const embed: Embed = {
    color: COLOR_PLAYING,
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
  answerName?: string | null;
}

export interface RenderedRecap {
  embed: Embed;
  file: FollowupFile;
}

export async function buildYesterdayRecapEmbed({
  puzzleId,
  players,
  answerName,
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
    subtitle: answerName ? `Answer: ${answerName}` : "Yesterday's results",
  });

  return {
    embed: {
      color: COLOR_RECAP,
      image: { url: `attachment://${RECAP_FILENAME}` },
    },
    file: { filename: RECAP_FILENAME, data: png, contentType: "image/png" },
  };
}
