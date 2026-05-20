import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

// Composites the PNGs we ship alongside the Now Playing + recap embeds. The
// goal is the Wordle-style "image embed" look — a single rendered PNG with
// the puzzle title up top and per-player rows below. Discord renders the
// attached PNG inline via `attachment://<filename>` on the embed image url.

const BG = "#1c1c1f";
const PANEL = "#26272b";
const PANEL_BORDER = "#3a3b40";
const TEXT = "#ffffff";
const SUBTEXT = "#b5b8bf";

const PIP_PLAY = "#3a3b40"; // unused guess slot
const PIP_USED = "#5a5b62"; // a guess was spent here (history not available)
const PIP_WIN = "#3aa55d";
const PIP_LOSS = "#ed4245";

const TITLE_H = 80;
const ROW_H = 76;
const ROW_GAP = 10;
const PANEL_PAD_X = 24;
const PANEL_PAD_Y = 18;
const AVATAR = 56;
const PIP_SIZE = 32;
const PIP_GAP = 6;
const WIDTH = 760;

// ---------- Now Playing --------------------------------------------------

export interface NowPlayingImageParticipant {
  displayName: string;
  avatarUrl: string | null;
  guessesUsed: number;
  status: "playing" | "won" | "lost";
}

export interface NowPlayingImageInput {
  puzzleId: string;
  participants: NowPlayingImageParticipant[];
}

export async function renderNowPlayingImage(input: NowPlayingImageInput): Promise<Buffer> {
  const rows = Math.max(1, input.participants.length);
  const panelH = PANEL_PAD_Y * 2 + rows * ROW_H + (rows - 1) * ROW_GAP;
  const height = TITLE_H + panelH + 24;
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, height);

  // Title.
  ctx.fillStyle = TEXT;
  ctx.font = "700 30px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`Holodle No. ${input.puzzleId}`, WIDTH / 2, 44);

  // Subtitle.
  ctx.fillStyle = SUBTEXT;
  ctx.font = "500 17px sans-serif";
  const subtitle =
    input.participants.length === 1
      ? "1 player currently playing"
      : `${input.participants.length} players currently playing`;
  ctx.fillText(subtitle, WIDTH / 2, 70);

  // Panel.
  const panelW = WIDTH - 48;
  const panelX = (WIDTH - panelW) / 2;
  const panelY = TITLE_H + 4;
  drawPanel(ctx, panelX, panelY, panelW, panelH);

  if (input.participants.length === 0) {
    ctx.fillStyle = SUBTEXT;
    ctx.font = "500 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for players…", WIDTH / 2, panelY + panelH / 2);
    return canvas.toBuffer("image/png");
  }

  for (let i = 0; i < input.participants.length; i++) {
    const p = input.participants[i];
    if (!p) continue;
    const rowY = panelY + PANEL_PAD_Y + i * (ROW_H + ROW_GAP);
    await drawParticipantRow(ctx, panelX + PANEL_PAD_X, rowY, panelW - PANEL_PAD_X * 2, p);
  }

  return canvas.toBuffer("image/png");
}

async function drawParticipantRow(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  p: NowPlayingImageParticipant,
): Promise<void> {
  const avatarY = y + (ROW_H - AVATAR) / 2;
  await drawAvatar(ctx, p.avatarUrl, x, avatarY, AVATAR);

  // Name + status text stacked to the right of the avatar.
  const textX = x + AVATAR + 16;
  ctx.fillStyle = TEXT;
  ctx.font = "600 20px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(truncate(ctx, p.displayName, 280), textX, y + 28);

  ctx.fillStyle = statusColor(p.status);
  ctx.font = "500 15px sans-serif";
  ctx.fillText(statusLine(p), textX, y + 52);

  // 6-pip progress bar on the right.
  const pipsW = 6 * PIP_SIZE + 5 * PIP_GAP;
  const pipsX = x + w - pipsW;
  const pipsY = y + (ROW_H - PIP_SIZE) / 2;
  drawPips(ctx, pipsX, pipsY, p);
}

function statusColor(status: NowPlayingImageParticipant["status"]): string {
  if (status === "won") return PIP_WIN;
  if (status === "lost") return PIP_LOSS;
  return SUBTEXT;
}

function statusLine(p: NowPlayingImageParticipant): string {
  if (p.status === "won") return `Won in ${p.guessesUsed}/6`;
  if (p.status === "lost") return `Lost (X/6)`;
  return `Playing — ${p.guessesUsed}/6`;
}

function drawPips(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  p: NowPlayingImageParticipant,
): void {
  for (let i = 0; i < 6; i++) {
    const cx = x + i * (PIP_SIZE + PIP_GAP);
    let fill = PIP_PLAY;
    if (i < p.guessesUsed) {
      // The last used pip carries the outcome color; intermediate pips show
      // "used" gray since we don't have per-guess hint history at this level.
      if (i === p.guessesUsed - 1 && p.status === "won") fill = PIP_WIN;
      else if (i === p.guessesUsed - 1 && p.status === "lost") fill = PIP_LOSS;
      else fill = PIP_USED;
    }
    ctx.fillStyle = fill;
    roundedRect(ctx, cx, y, PIP_SIZE, PIP_SIZE, 6);
    ctx.fill();
  }
}

async function drawAvatar(
  ctx: SKRSContext2D,
  url: string | null,
  x: number,
  y: number,
  size: number,
): Promise<void> {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#1c1c1f";
  ctx.fill();
  ctx.clip();
  if (url) {
    try {
      const img = await loadImage(url);
      ctx.drawImage(img, x, y, size, size);
    } catch (err) {
      console.warn("[discord] avatar load failed:", err);
    }
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = PANEL_BORDER;
  ctx.stroke();
}

// ---------- Recap --------------------------------------------------------

export interface RecapImagePlayer {
  guessesUsed: number;
  status: "won" | "lost";
}

export interface RecapImageInput {
  puzzleId: string;
  players: RecapImagePlayer[];
  answerName?: string | null;
}

const RECAP_ROW_H = 44;
const RECAP_ROW_GAP = 8;

export function renderRecapImage(input: RecapImageInput): Buffer {
  type Bucket = { label: string; count: number; tone: "win" | "loss" };
  const winCounts = new Map<number, number>();
  let lossCount = 0;
  for (const p of input.players) {
    if (p.status === "won") {
      winCounts.set(p.guessesUsed, (winCounts.get(p.guessesUsed) ?? 0) + 1);
    } else {
      lossCount += 1;
    }
  }
  const buckets: Bucket[] = [];
  for (const n of [...winCounts.keys()].sort((a, b) => a - b)) {
    buckets.push({ label: `${n}/6`, count: winCounts.get(n)!, tone: "win" });
  }
  if (lossCount > 0) buckets.push({ label: "X/6", count: lossCount, tone: "loss" });

  const rows = Math.max(1, buckets.length);
  const panelH = 24 * 2 + rows * RECAP_ROW_H + (rows - 1) * RECAP_ROW_GAP;
  const footerH = input.answerName ? 36 : 0;
  const height = TITLE_H + panelH + footerH + 24;

  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, WIDTH, height);

  // Title.
  ctx.fillStyle = TEXT;
  ctx.font = "700 30px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`Holodle No. ${input.puzzleId}`, WIDTH / 2, 44);

  ctx.fillStyle = SUBTEXT;
  ctx.font = "500 16px sans-serif";
  ctx.fillText("Yesterday's results", WIDTH / 2, 70);

  // Panel.
  const panelW = WIDTH - 48;
  const panelX = (WIDTH - panelW) / 2;
  const panelY = TITLE_H + 4;
  drawPanel(ctx, panelX, panelY, panelW, panelH);

  if (buckets.length === 0) {
    ctx.fillStyle = SUBTEXT;
    ctx.font = "500 18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No completed games in the past day.", WIDTH / 2, panelY + panelH / 2);
  } else {
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (!b) continue;
      const rowY = panelY + 24 + i * (RECAP_ROW_H + RECAP_ROW_GAP);
      // Chip.
      const chipW = 64;
      const chipX = panelX + 24;
      ctx.fillStyle = b.tone === "win" ? PIP_WIN : PIP_USED;
      roundedRect(ctx, chipX, rowY + 4, chipW, RECAP_ROW_H - 8, 8);
      ctx.fill();
      ctx.fillStyle = TEXT;
      ctx.font = "700 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(b.label, chipX + chipW / 2, rowY + RECAP_ROW_H / 2);

      ctx.textAlign = "left";
      ctx.fillStyle = TEXT;
      ctx.font = "500 18px sans-serif";
      const label = `${b.count} player${b.count === 1 ? "" : "s"}`;
      ctx.fillText(label, chipX + chipW + 14, rowY + RECAP_ROW_H / 2);
    }
  }

  if (input.answerName) {
    ctx.fillStyle = SUBTEXT;
    ctx.font = "500 15px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`Answer: ${input.answerName}`, WIDTH / 2, panelY + panelH + 18);
  }

  return canvas.toBuffer("image/png");
}

// ---------- shared shapes ------------------------------------------------

function drawPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number): void {
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = PANEL_BORDER;
  ctx.stroke();
}

function roundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function truncate(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = `${text.slice(0, mid)}${ellipsis}`;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid;
  }
  return `${text.slice(0, lo)}${ellipsis}`;
}
