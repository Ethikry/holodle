import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { BOARD_COLUMNS, type GuessDiff } from "@holodle/shared";

// Renders the PNG attached to Now Playing + Recap embeds. Mirrors the Wordle
// posted-message layout: a small "HOLO ✦ DLE No. N" title up top and a grid
// of per-participant tiles below. Each tile = circular avatar + 6×6 colored
// grid showing that player's guess history. Layout adapts to participant
// count: a wide horizontal panel for one player, narrow vertical cards for
// 2–3, and a tile grid for larger groups.

const BG = "#1c1c1f";
const TILE_BG = "transparent";
const TILE_BORDER = "#3a3b40";
const CELL_EMPTY = "#1f2024";
const CELL_USED = "#3a3b40";
const CELL_EQUAL = "#3aa55d";
const CELL_PARTIAL = "#c89b3f";
const CELL_BORDER = "#1c1c1f";

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

interface TileMetrics {
  width: number;
  height: number;
  cols: number;
  rows: number;
  avatar: number;
  cell: number;
  cellGap: number;
  gridPadTop: number;
  layout: "horizontal" | "vertical";
}

interface OverallLayout {
  width: number;
  height: number;
  tile: TileMetrics;
  tileCols: number; // tiles per row
  tileGap: number;
  contentY: number; // y-coord where tiles start
  padX: number;
}

const TITLE_BAND_H = 64;
const SUBTITLE_BAND_H = 26;
const BOTTOM_PAD = 24;
const SIDE_PAD = 24;
const TILE_GAP = 14;

function planLayout(n: number, hasSubtitle: boolean): OverallLayout {
  if (n <= 1) {
    // Single wide horizontal tile, like Wordle's solo card.
    const tile: TileMetrics = {
      width: 700,
      height: 360,
      cols: GRID_COLS,
      rows: GRID_ROWS,
      avatar: 220,
      cell: 38,
      cellGap: 6,
      gridPadTop: 0,
      layout: "horizontal",
    };
    return wrapLayout([tile], 1, hasSubtitle);
  }
  if (n === 2) {
    const tile = verticalTile({ avatar: 150, cell: 36 });
    return wrapLayout([tile, tile], 2, hasSubtitle);
  }
  if (n === 3) {
    const tile = verticalTile({ avatar: 130, cell: 32 });
    return wrapLayout([tile, tile, tile], 3, hasSubtitle);
  }
  if (n <= 6) {
    const tile = verticalTile({ avatar: 96, cell: 22 });
    return wrapLayout(repeat(tile, n), 3, hasSubtitle);
  }
  if (n <= 12) {
    const tile = verticalTile({ avatar: 76, cell: 18 });
    const cols = Math.min(6, Math.ceil(n / 2));
    return wrapLayout(repeat(tile, n), cols, hasSubtitle);
  }
  // 13+ — pack 7-per-row like the Wordle group-of-13 screenshot.
  const tile = verticalTile({ avatar: 64, cell: 14 });
  const cols = 7;
  return wrapLayout(repeat(tile, n), cols, hasSubtitle);
}

function verticalTile(opts: { avatar: number; cell: number }): TileMetrics {
  const cellGap = Math.max(2, Math.round(opts.cell * 0.16));
  const gridW = GRID_COLS * opts.cell + (GRID_COLS - 1) * cellGap;
  const gridH = GRID_ROWS * opts.cell + (GRID_ROWS - 1) * cellGap;
  // Tile padding: 12px around content; avatar above grid with a small gap.
  const innerPadY = 14;
  const innerPadX = 12;
  const avatarGridGap = 12;
  const width = Math.max(opts.avatar + innerPadX * 2, gridW + innerPadX * 2);
  const height = innerPadY * 2 + opts.avatar + avatarGridGap + gridH;
  return {
    width,
    height,
    cols: GRID_COLS,
    rows: GRID_ROWS,
    avatar: opts.avatar,
    cell: opts.cell,
    cellGap,
    gridPadTop: innerPadY + opts.avatar + avatarGridGap,
    layout: "vertical",
  };
}

function repeat<T>(value: T, n: number): T[] {
  return Array.from({ length: n }, () => value);
}

function wrapLayout(tiles: TileMetrics[], cols: number, hasSubtitle: boolean): OverallLayout {
  const first = tiles[0]!;
  const rows = Math.ceil(tiles.length / cols);
  const tilesWidth = cols * first.width + (cols - 1) * TILE_GAP;
  const tilesHeight = rows * first.height + (rows - 1) * TILE_GAP;
  const width = SIDE_PAD * 2 + tilesWidth;
  const contentY = TITLE_BAND_H + (hasSubtitle ? SUBTITLE_BAND_H : 0);
  const height = contentY + tilesHeight + BOTTOM_PAD;
  return {
    width,
    height,
    tile: first,
    tileCols: cols,
    tileGap: TILE_GAP,
    contentY,
    padX: SIDE_PAD,
  };
}

// ---------- Public render ------------------------------------------------

export async function renderNowPlayingImage(input: NowPlayingImageInput): Promise<Buffer> {
  const hasSubtitle = !!input.subtitle;
  const layout = planLayout(input.participants.length, hasSubtitle);
  const canvas = createCanvas(layout.width, layout.height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, layout.width, layout.height);

  drawTitle(ctx, layout.width, input.puzzleNumber, input.puzzleId);

  if (hasSubtitle && input.subtitle) {
    ctx.fillStyle = SUBTEXT;
    ctx.font = "500 14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(input.subtitle, layout.width / 2, TITLE_BAND_H + SUBTITLE_BAND_H / 2);
  }

  if (input.participants.length === 0) {
    ctx.fillStyle = SUBTEXT;
    ctx.font = "500 16px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Waiting for players…", layout.width / 2, layout.height / 2);
    return canvas.toBuffer("image/png");
  }

  // Draw tiles.
  for (let i = 0; i < input.participants.length; i++) {
    const p = input.participants[i];
    if (!p) continue;
    const col = i % layout.tileCols;
    const row = Math.floor(i / layout.tileCols);
    const tx = layout.padX + col * (layout.tile.width + layout.tileGap);
    const ty = layout.contentY + row * (layout.tile.height + layout.tileGap);
    await drawTile(ctx, tx, ty, layout.tile, p);
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

  const wordFont = "800 28px sans-serif";
  const numFont = "600 22px sans-serif";

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

async function drawTile(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  tile: TileMetrics,
  p: NowPlayingImageParticipant,
): Promise<void> {
  // Rounded border around the whole tile (Wordle uses a thin grey outline).
  roundedRect(ctx, x, y, tile.width, tile.height, 18);
  if (TILE_BG !== "transparent") {
    ctx.fillStyle = TILE_BG;
    ctx.fill();
  }
  ctx.strokeStyle = TILE_BORDER;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (tile.layout === "horizontal") {
    const innerPadX = 28;
    const innerPadY = (tile.height - tile.avatar) / 2;
    await drawAvatarCircle(ctx, p.avatarUrl, x + innerPadX, y + innerPadY, tile.avatar);
    const gridW = GRID_COLS * tile.cell + (GRID_COLS - 1) * tile.cellGap;
    const gridH = GRID_ROWS * tile.cell + (GRID_ROWS - 1) * tile.cellGap;
    const gridX = x + tile.width - innerPadX - gridW;
    const gridY = y + (tile.height - gridH) / 2;
    drawGuessGrid(ctx, gridX, gridY, tile.cell, tile.cellGap, p.history);
    return;
  }

  // Vertical tile: avatar centered up top, grid centered below.
  const avatarX = x + (tile.width - tile.avatar) / 2;
  const avatarY = y + 14;
  await drawAvatarCircle(ctx, p.avatarUrl, avatarX, avatarY, tile.avatar);

  const gridW = GRID_COLS * tile.cell + (GRID_COLS - 1) * tile.cellGap;
  const gridX = x + (tile.width - gridW) / 2;
  const gridY = y + tile.gridPadTop;
  drawGuessGrid(ctx, gridX, gridY, tile.cell, tile.cellGap, p.history);
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
  glyph?: string;
}

// Maps column states dynamically based on shared BOARD_COLUMNS, preventing alignment/typographical drift.
function cellRenderAt(diff: GuessDiff | undefined, col: number): CellRender {
  if (!diff) return { fill: CELL_USED };
  const key = BOARD_COLUMNS[col];
  if (!key) return { fill: CELL_USED };
  const c = diff[key];
  if (!c) return { fill: CELL_USED };
  if (c.state === "equal") return { fill: CELL_EQUAL };
  if (c.state === "partial") return { fill: CELL_PARTIAL };
  return { fill: CELL_USED };
}

function drawGuessCell(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  r: CellRender,
): void {
  ctx.fillStyle = r.fill;
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = CELL_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, size, size);
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