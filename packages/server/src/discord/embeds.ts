// Embed + component builders for the user-install flow. The visible content
// of every bot-posted message is now a composited PNG (see imageRender.ts);
// the embed itself is minimal scaffolding so Discord renders the attached
// image inline. We intentionally duplicate the minimal types we need here
// rather than depending on a `discord.js` client — the only thing that ever
// consumes these is JSON.stringify into a webhook POST body.

import {
  renderNowPlayingImage,
  renderRecapImage,
  type NowPlayingImageParticipant,
  type RecapImagePlayer,
} from "./imageRender.js";
import type { FollowupFile } from "./followups.js";

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

export interface ButtonComponent {
  type: 2;
  style: 5; // LINK
  label: string;
  url: string;
}

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
  applicationId,
}: NowPlayingInput): Promise<RenderedMessage> {
  const imageParticipants: NowPlayingImageParticipant[] = participants.map((p) => ({
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    guessesUsed: p.guessesUsed,
    status: p.status,
  }));
  const png = await renderNowPlayingImage({ puzzleId, participants: imageParticipants });

  const embed: Embed = {
    color: COLOR_PLAYING,
    image: { url: `attachment://${NOW_PLAYING_FILENAME}` },
  };

  const button: ButtonComponent = {
    type: 2,
    style: 5,
    label: "Play now!",
    url: `https://discord.com/activities/${applicationId}`,
  };
  const components: MessageComponent[] = [{ type: 1, components: [button] }];

  return {
    embed,
    components,
    file: { filename: NOW_PLAYING_FILENAME, data: png, contentType: "image/png" },
  };
}

export interface RecapPlayer {
  userId: string;
  guessesUsed: number;
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

export function buildYesterdayRecapEmbed({
  puzzleId,
  players,
  answerName,
}: RecapEmbedInput): RenderedRecap {
  const imagePlayers: RecapImagePlayer[] = players.map((p) => ({
    guessesUsed: p.guessesUsed,
    status: p.status,
  }));
  const png = renderRecapImage({ puzzleId, players: imagePlayers, answerName });

  return {
    embed: {
      color: COLOR_RECAP,
      image: { url: `attachment://${RECAP_FILENAME}` },
    },
    file: { filename: RECAP_FILENAME, data: png, contentType: "image/png" },
  };
}
