import type { GameStatus, GuessDiff, TalentSummary } from "@holodle/shared";
import type { DiscordEmbed } from "./client.js";

// Discord embed colors. Picked to match the Tailwind palette in the activity.
const COLOR_WIN = 0x16a34a;
const COLOR_LOSS = 0xdc2626;
const COLOR_PARTIAL = 0x22b8e6;
const COLOR_RECAP = 0x22b8e6;

const SQUARE_EQUAL = "🟩";
const SQUARE_WRONG = "🟥";

// Convert a single guess into a row of six colored squares — one per
// attribute column (gen, branch, year, archetype, height, month). Without
// the "near" state every cell is either equal-green or wrong-red.
function gridRow(diff: GuessDiff): string {
  const cells = [
    diff.generation,
    diff.branch,
    diff.debutYear,
    diff.archetype,
    diff.height,
    diff.birthMonth,
  ];
  return cells.map((c) => (c.state === "equal" ? SQUARE_EQUAL : SQUARE_WRONG)).join("");
}

function gridBlock(history: GuessDiff[]): string {
  if (history.length === 0) return "_(no guesses)_";
  return history.map(gridRow).join("\n");
}

export interface ExitEmbedInput {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  history: GuessDiff[];
  status: GameStatus;
  answer: TalentSummary | null; // present on settle, null mid-game
  puzzleId: string;
}

export function buildExitEmbed({
  userId,
  displayName,
  avatarUrl,
  history,
  status,
  answer,
  puzzleId,
}: ExitEmbedInput): DiscordEmbed {
  const mention = `<@${userId}>`;
  const guesses = history.length;
  let color: number;
  let description: string;

  if (status === "won") {
    color = COLOR_WIN;
    const name = answer?.name ?? "today's talent";
    description = `${mention} found **${name}** in ${guesses}/6`;
  } else if (status === "lost") {
    color = COLOR_LOSS;
    const name = answer?.name;
    description = name
      ? `${mention} couldn't guess **${name}** today (X/6)`
      : `${mention} couldn't guess today's talent (X/6)`;
  } else {
    color = COLOR_PARTIAL;
    description = `${mention} stepped away (${guesses}/6)`;
  }

  const embed: DiscordEmbed = {
    title: `Holodle — ${puzzleId}`,
    description,
    color,
    fields: [{ name: `Grid (${guesses}/6)`, value: gridBlock(history) }],
    footer: { text: `${displayName} · Holodle` },
  };
  if (avatarUrl) embed.thumbnail = { url: avatarUrl };
  return embed;
}

// --- Recap (step H — implemented here so we can reuse the helpers) -------

export interface RecapPlayer {
  userId: string;
  guessesUsed: number;
  status: "won" | "lost";
  puzzleId: string;
}

export interface RecapEmbedInput {
  windowLabel: string; // e.g. "2026-05-19" — what to call this recap
  players: RecapPlayer[];
}

export function buildRecapEmbed({ windowLabel, players }: RecapEmbedInput): DiscordEmbed {
  // Group by score. Wins keyed by guessesUsed; losses get their own bucket.
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

  const fields: DiscordEmbed["fields"] = [];
  for (const n of [...wins.keys()].sort((a, b) => a - b)) {
    fields.push({ name: `${n}/6`, value: wins.get(n)!.join(" ") });
  }
  if (losses.length > 0) {
    fields.push({ name: "X/6 (couldn't guess)", value: losses.join(" ") });
  }

  return {
    title: `Holodle — last 24 hours (${windowLabel})`,
    description:
      players.length === 0
        ? "_No completed games in the past day._"
        : "Each player's puzzle rolls over with their local midnight, so the answer they were chasing varies per timezone.",
    color: COLOR_RECAP,
    fields,
  };
}
