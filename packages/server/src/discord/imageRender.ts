import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { BOARD_COLUMNS, type GuessDiff } from "@holodle/shared";

// Renders the PNG attached to Now Playing + Recap embeds. Mirrors the Wordle
// posted-message layout: a small "HOLO ✦ DLE No. N" title up top and a grid
// of per-participant tiles below. Each tile = circular avatar + 6×6 colored
// grid showing that player's guess history. Layout adapts to participant
// count: a wide horizontal panel for one player, narrow vertical cards for
// 2–3, and a tile grid for larger groups.

const BG = "#1a1a1b";
const TILE_BG = "transparent";
const TILE_BORDER = "#3a3b40";

// Cell colors. High-contrast, saturated fills with a darker same-hue outline so
// every block reads crisply against the near-black background.
//
// Empty / no-guess cells are a distinct dark gray (Wordle-style) rather than the
// background color — that contrast is what makes the grid look sharp.
const CELL_EMPTY_BG = "#3a3a3c";
const CELL_EMPTY_BD = "#4d4d50";

// Wrong: a clear, saturated red.
const CELL_WRONG_BG = "#c4453a";
const CELL_WRONG_BD = "#8c2e26";

// Correct: vivid green.
const CELL_EQUAL_BG = "#4ca455";
const CELL_EQUAL_BD = "#2c7838";

// Partial: clear yellow.
const CELL_PARTIAL_BG = "#d9b441";
const CELL_PARTIAL_BD = "#a07d1c";

const CELL_BORDER = "#1a1a1b";

const TITLE_INK = "#ffffff";
const SUBTEXT = "#b5b8bf";

// Six attribute columns: branch / generation / penlight / archetype /
// height / birthMonth. Six guess rows. Stays in sync with BOARD_COLUMNS
// in @holodle/shared.
const GRID_COLS = 6;
const GRID_ROWS = 6;

// ---------- Public types -------------------------------------------------

export interface NowPlayingImageParticipant {
  avatarUrl: string | null;
  history: GuessDiff[];
  status: "playing" | "won" | "lost";
}

export interface NowPlayingImageInput {
  puzzleId: string;
  puzzleNumber?: number; // 1-based; falls back to date string when absent
  participants: NowPlayingImageParticipant[];
  subtitle?: string | null;
}

// Re-exported for the recap path that builds on top of the same renderer.
export interface RecapImagePlayer {
  avatarUrl: string | null;
  history: GuessDiff[];
  status: "won" | "lost";
}

export interface RecapImageInput {
  puzzleId: string;
  puzzleNumber?: number;
  players: RecapImagePlayer[];
  answerName?: string | null;
}

// ---------- Layout planning ---------------------------------------------
//
// The output image is a FIXED size regardless of how many boards it carries
// (bug 4). We lay the N participant cards into a grid that fills the content
// area and scale every card uniformly to fit — one board fills the canvas,
// many boards each shrink, but the embed's footprint in Discord never moves.

// Fixed logical canvas footprint (landscape, ~1.8:1, like Wordle's shared
// card). The PNG is rendered at SUPERSAMPLE× this so it stays crisp when
// Discord scales it up on high-DPI / retina displays — a 1× image gets
// upscaled there and looks fuzzy. Discord caps how large an embed image
// *displays* (it scales the PNG to fit the embed's media box), so a bigger
// pixel buffer buys sharpness, not display size.
const CANVAS_W = 540;
const CANVAS_H = 300;
const SUPERSAMPLE = 3;

const TITLE_BAND_H = 44;
const SUBTITLE_BAND_H = 20;
const BOTTOM_PAD = 16;
const SIDE_PAD = 18;
const TILE_GAP = 10;

// Per-card padding + the gap between the avatar and the grid beside it.
const INNER_PAD_X = 10;
const INNER_PAD_Y = 10;
const AVATAR_GRID_GAP = 10;
const CELL_GAP_RATIO = 0.12;

// Width (and height) of a 6×N grid expressed as a multiple of one cell, when
// the inter-cell gap is CELL_GAP_RATIO × cell. gridW = cell·K.
const GRID_SPAN_K = GRID_COLS + (GRID_COLS - 1) * CELL_GAP_RATIO;

interface RenderPlan {
  width: number;
  height: number;
  contentY: number;
  cols: number;
  rows: number;
  slotW: number;
  slotH: number;
  cell: number;
  cellGap: number;
  gridW: number;
  gridH: number;
  avatar: number;
}

// Choose the column count (1..n) that maximizes the per-card cell size, so
// the boards are as large as the fixed content area allows. Cards are
// horizontal: a circular avatar on the LEFT, the 6×6 guess grid on the RIGHT,
// the avatar sized to the grid's height (Wordle-style).
function planLayout(n: number, hasSubtitle: boolean): RenderPlan {
  const contentY = TITLE_BAND_H + (hasSubtitle ? SUBTITLE_BAND_H : 0);
  const contentW = CANVAS_W - SIDE_PAD * 2;
  const contentH = CANVAS_H - contentY - BOTTOM_PAD;

  const base: RenderPlan = {
    width: CANVAS_W,
    height: CANVAS_H,
    contentY,
    cols: 0,
    rows: 0,
    slotW: 0,
    slotH: 0,
    cell: 0,
    cellGap: 2,
    gridW: 0,
    gridH: 0,
    avatar: 0,
  };
  if (n <= 0) return base;

  let bestCols = 1;
  let bestSlotW = 0;
  let bestSlotH = 0;
  let bestCell = -1;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const slotW = (contentW - (cols - 1) * TILE_GAP) / cols;
    const slotH = (contentH - (rows - 1) * TILE_GAP) / rows;
    if (slotW <= 0 || slotH <= 0) continue;
    const innerW = slotW - INNER_PAD_X * 2;
    const innerH = slotH - INNER_PAD_Y * 2;
    // Horizontal card: avatar (= grid side = cell·K) + gap + grid (= cell·K)
    // across; height is just the grid side (cell·K).
    const cellFromW = (innerW - AVATAR_GRID_GAP) / (2 * GRID_SPAN_K);
    const cellFromH = innerH / GRID_SPAN_K;
    const cell = Math.min(cellFromW, cellFromH);
    if (cell > bestCell) {
      bestCell = cell;
      bestCols = cols;
      bestSlotW = slotW;
      bestSlotH = slotH;
    }
  }

  // Floor (never raise above what fits) so the grid can't overflow the slot.
  const cell = Math.max(2, Math.floor(bestCell));
  const cellGap = Math.max(2, Math.round(cell * CELL_GAP_RATIO));
  const gridSide = GRID_COLS * cell + (GRID_COLS - 1) * cellGap;
  return {
    ...base,
    cols: bestCols,
    rows: Math.ceil(n / bestCols),
    slotW: bestSlotW,
    slotH: bestSlotH,
    cell,
    cellGap,
    gridW: gridSide,
    gridH: gridSide,
    avatar: gridSide, // avatar diameter matches the grid height
  };
}

// ---------- Public render ------------------------------------------------

export async function renderNowPlayingImage(input: NowPlayingImageInput): Promise<Buffer> {
  const hasSubtitle = !!input.subtitle;
  const n = input.participants.length;
  const layout = planLayout(n, hasSubtitle);
  // Render at SUPERSAMPLE× and let Discord downscale → crisp on retina. All
  // drawing below stays in logical (un-scaled) coordinates.
  const canvas = createCanvas(layout.width * SUPERSAMPLE, layout.height * SUPERSAMPLE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SUPERSAMPLE, SUPERSAMPLE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, layout.width, layout.height);

  drawTitle(ctx, layout.width, input.puzzleNumber, input.puzzleId);

  if (hasSubtitle && input.subtitle) {
    ctx.fillStyle = SUBTEXT;
    ctx.font = "500 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(input.subtitle, layout.width / 2, TITLE_BAND_H + SUBTITLE_BAND_H / 2);
  }

  if (n === 0) {
    ctx.fillStyle = SUBTEXT;
    ctx.font = "500 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Waiting for players…", layout.width / 2, layout.height / 2);
    return canvas.toBuffer("image/png");
  }

  const contentW = CANVAS_W - SIDE_PAD * 2;
  // Horizontal card: avatar + gap + grid across; height is the grid side.
  const blockW = layout.avatar + AVATAR_GRID_GAP + layout.gridW;
  const blockH = Math.max(layout.avatar, layout.gridH);

  for (let i = 0; i < n; i++) {
    const p = input.participants[i];
    if (!p) continue;
    const col = i % layout.cols;
    const row = Math.floor(i / layout.cols);
    // Center the (possibly short) final row.
    const rowCount = row === layout.rows - 1 ? n - row * layout.cols : layout.cols;
    const rowWidth = rowCount * layout.slotW + (rowCount - 1) * TILE_GAP;
    const rowStartX = SIDE_PAD + (contentW - rowWidth) / 2;
    const slotX = rowStartX + col * (layout.slotW + TILE_GAP);
    const slotY = layout.contentY + row * (layout.slotH + TILE_GAP);
    // Center the card content within its slot.
    const bx = slotX + (layout.slotW - blockW) / 2;
    const by = slotY + (layout.slotH - blockH) / 2;
    await drawTile(ctx, bx, by, blockW, blockH, layout, p);
  }

  return canvas.toBuffer("image/png");
}

// ---------- Title --------------------------------------------------------

function drawTitle(
  ctx: SKRSContext2D,
  width: number,
  puzzleNumber: number | undefined,
  fallbackPuzzleId: string,
): void {
  // Plain "holodle  No. {n}" in white. The earlier two-color HOLO✦DLE
  // wordmark was replaced because the lowercase wordmark is what we use
  // everywhere else (chat copy, in-activity Header).
  const numberLabel = puzzleNumber !== undefined ? `${puzzleNumber}` : fallbackPuzzleId;
  const suffix = `  No. ${numberLabel}`;

  const wordFont = "800 24px sans-serif";
  const numFont = "600 18px sans-serif";

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  // Measure to center the composite as a unit.
  ctx.font = wordFont;
  const wWord = ctx.measureText("holodle").width;
  ctx.font = numFont;
  const wNum = ctx.measureText(suffix).width;
  const totalW = wWord + wNum;

  let x = (width - totalW) / 2;
  const y = TITLE_BAND_H / 2;

  ctx.fillStyle = TITLE_INK;
  ctx.font = wordFont;
  ctx.fillText("holodle", x, y);
  x += wWord;

  ctx.fillStyle = SUBTEXT;
  ctx.font = numFont;
  ctx.fillText(suffix, x, y);
}

// ---------- Tiles --------------------------------------------------------

// Draws one participant card: a rounded border around (avatar + grid), with the
// circular avatar on the LEFT and the 6×6 guess grid on the RIGHT, both
// vertically centered. (bx, by) is the top-left of the content block;
// blockW/blockH bound it.
async function drawTile(
  ctx: SKRSContext2D,
  bx: number,
  by: number,
  blockW: number,
  blockH: number,
  plan: RenderPlan,
  p: NowPlayingImageParticipant,
): Promise<void> {
  // Rounded border around the card, padded out from the content block.
  const cardX = bx - INNER_PAD_X;
  const cardY = by - INNER_PAD_Y;
  const cardW = blockW + INNER_PAD_X * 2;
  const cardH = blockH + INNER_PAD_Y * 2;
  const radius = Math.min(18, cardH / 4);
  roundedRect(ctx, cardX, cardY, cardW, cardH, radius);
  if (TILE_BG !== "transparent") {
    ctx.fillStyle = TILE_BG;
    ctx.fill();
  }
  ctx.strokeStyle = TILE_BORDER;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Avatar on the left, grid on the right, both vertically centered.
  const avatarY = by + (blockH - plan.avatar) / 2;
  await drawAvatarCircle(ctx, p.avatarUrl, bx, avatarY, plan.avatar);

  const gridX = bx + plan.avatar + AVATAR_GRID_GAP;
  const gridY = by + (blockH - plan.gridH) / 2;
  drawGuessGrid(ctx, gridX, gridY, plan.cell, plan.cellGap, p.history);
}

function drawGuessGrid(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  cell: number,
  gap: number,
  history: GuessDiff[],
): void {
  for (let row = 0; row < GRID_ROWS; row++) {
    const diff = history[row];
    for (let col = 0; col < GRID_COLS; col++) {
      const cx = x + col * (cell + gap);
      const cy = y + row * (cell + gap);
      drawGuessCell(ctx, cx, cy, cell, cellRenderAt(diff, col));
    }
  }
}

interface CellRender {
  fill: string;
  border?: string; // Optional outline color
  glyph?: string;
}

// Maps column states dynamically based on shared BOARD_COLUMNS.
function cellRenderAt(diff: GuessDiff | undefined, col: number): CellRender {
  if (!diff) return { fill: CELL_EMPTY_BG, border: CELL_EMPTY_BD };
  const key = BOARD_COLUMNS[col];
  if (!key) return { fill: CELL_EMPTY_BG, border: CELL_EMPTY_BD };
  const c = diff[key];
  if (!c) return { fill: CELL_EMPTY_BG, border: CELL_EMPTY_BD };
  
  if (c.state === "equal") {
    return { fill: CELL_EQUAL_BG, border: CELL_EQUAL_BD };
  }
  if (c.state === "partial") {
    return { fill: CELL_PARTIAL_BG, border: CELL_PARTIAL_BD };
  }
  return { fill: CELL_WRONG_BG, border: CELL_WRONG_BD };
}

function drawGuessCell(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  r: CellRender,
): void {
  const borderRadius = 3; // Renders curved cell edges matching client's rounded-[3px] Look

  // Fill cell background
  ctx.fillStyle = r.fill;
  roundedRect(ctx, x, y, size, size, borderRadius);
  ctx.fill();

  // Stroke cell border
  ctx.strokeStyle = r.border ?? CELL_BORDER;
  ctx.lineWidth = 1.5;
  roundedRect(ctx, x, y, size, size, borderRadius);
  ctx.stroke();

  if (r.glyph && size >= 24) {
    ctx.fillStyle = TITLE_INK;
    ctx.font = `700 ${Math.round(size * 0.7)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(r.glyph, x + size / 2, y + size / 2 + 1);
  }
}

async function drawAvatarCircle(
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
  ctx.strokeStyle = TILE_BORDER;
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

// ---------- Legacy recap (kept for fallback) -----------------------------

export function renderRecapImage(input: RecapImageInput): Buffer {
  void input;
  throw new Error(
    "renderRecapImage is deprecated — use renderNowPlayingImage with a subtitle for recap output.",
  );
}