// Embed + component builders for the user-install flow. We intentionally
// duplicate the minimal types we need here rather than depending on a
// `discord.js` client — the only thing that ever consumes these is
// JSON.stringify into a webhook POST body.

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title?: string;
  description?: string;
  color?: number;
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

export interface NowPlayingParticipant {
  userId: string;
  displayName: string;
  guessesUsed: number;
  status: "playing" | "won" | "lost";
}

export interface NowPlayingInput {
  puzzleId: string;
  participants: NowPlayingParticipant[];
  applicationId: string;
}

export function buildNowPlayingEmbed({
  puzzleId,
  participants,
  applicationId,
}: NowPlayingInput): { embed: Embed; components: MessageComponent[] } {
  const count = participants.length;
  const noun = count === 1 ? "player" : "players";
  const fields: EmbedField[] = participants.map((p) => {
    let value: string;
    if (p.status === "won") value = `Won in ${p.guessesUsed}/6`;
    else if (p.status === "lost") value = `Lost (X/6)`;
    else value = `Playing — ${p.guessesUsed}/6`;
    return { name: p.displayName, value, inline: true };
  });

  const embed: Embed = {
    title: `Holodle No. ${puzzleId}`,
    description: `${count} ${noun} currently playing`,
    color: COLOR_PLAYING,
    fields,
  };

  const button: ButtonComponent = {
    type: 2,
    style: 5,
    label: "Play now!",
    url: `https://discord.com/activities/${applicationId}`,
  };
  const components: MessageComponent[] = [{ type: 1, components: [button] }];
  return { embed, components };
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

export function buildYesterdayRecapEmbed({
  puzzleId,
  players,
  answerName,
}: RecapEmbedInput): Embed {
  // Group wins by guesses-to-win; losses get their own bucket.
  const wins = new Map<number, string[]>();
  const losses: string[] = [];
  for (const p of players) {
    const mention = `<@${p.userId}>`;
    if (p.status === "won") {
      const arr = wins.get(p.guessesUsed) ?? [];
      arr.push(mention);
      wins.set(p.guessesUsed, arr);
    } else {
      losses.push(mention);
    }
  }
  const fields: EmbedField[] = [];
  for (const n of [...wins.keys()].sort((a, b) => a - b)) {
    fields.push({ name: `${n}/6`, value: wins.get(n)!.join(" ") });
  }
  if (losses.length > 0) {
    fields.push({ name: "X/6", value: losses.join(" ") });
  }
  return {
    title: `Holodle No. ${puzzleId}`,
    description: "Yesterday's results",
    color: COLOR_RECAP,
    fields,
    footer: answerName ? { text: answerName } : undefined,
  };
}
