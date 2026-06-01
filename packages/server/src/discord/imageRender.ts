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

// Wrong: a muted red — between the desaturated mauve and the fully-saturated
// red, so it reads clearly red without overpowering the green/yellow.
const CELL_WRONG_BG = "#9f4d4d";
const CELL_WRONG_BD = "#733636";

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

// Maximum embed image footprint (logical px). The canvas wraps the chosen
// layout's actual content but never exceeds this box, which is sized to fill
// as much of Discord's embed media area as it will display. The PNG is
// rendered at SUPERSAMPLE× so it stays crisp when Discord scales it up on
// high-DPI / retina displays (a 1× image gets upscaled there and looks
// fuzzy). Discord caps how large an embed image *displays*, so the larger
// pixel buffer buys sharpness, not display size.
const MAX_CANVAS_W = 560;
const MAX_CANVAS_H = 420;
const MIN_CANVAS_W = 260; // keep room for the title on narrow layouts
const SUPERSAMPLE = 3;

// The board is drawn at this fraction of the space it could fill, centered in
// the (otherwise unchanged) canvas. Discord scales the whole image to its
// embed box regardless of pixel size, so shrinking the canvas wouldn't shrink
// the *displayed* board — leaving margin inside a same-size canvas does.
const BOARD_SCALE = 0.7;

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

type CardOrientation = "vertical" | "horizontal";

interface RenderPlan {
  width: number;
  height: number;
  contentY: number;
  cols: number;
  rows: number;
  orientation: CardOrientation;
  cell: number;
  cellGap: number;
  gridSide: number; // the 6×6 grid is square
  avatar: number; // avatar diameter = gridSide
  blockW: number; // avatar+grid content block (no card padding)
  blockH: number;
  slotW: number; // card = block + inner padding
  slotH: number;
}

// Largest cell size (px) that fits a cols×rows grid of `orientation` cards
// within the given content box. Returns 0 if it can't fit at all.
// A card is a square avatar + the 6×6 grid: stacked for "vertical" (avatar on
// top), side-by-side for "horizontal" (avatar on the left). The avatar always
// matches the grid's side, and gridSide ≈ cell·K (K = GRID_SPAN_K).
function maxCellFor(
  orientation: CardOrientation,
  cols: number,
  rows: number,
  maxContentW: number,
  maxContentH: number,
): number {
  const perW = (maxContentW - (cols - 1) * TILE_GAP) / cols - INNER_PAD_X * 2;
  const perH = (maxContentH - (rows - 1) * TILE_GAP) / rows - INNER_PAD_Y * 2;
  if (perW <= 0 || perH <= 0) return 0;
  if (orientation === "vertical") {
    // block: w = gridSide (= cell·K); h = avatar + gap + gridSide (= 2·cell·K + gap)
    const cellFromW = perW / GRID_SPAN_K;
    const cellFromH = (perH - AVATAR_GRID_GAP) / (2 * GRID_SPAN_K);
    return Math.min(cellFromW, cellFromH);
  }
  // horizontal: block w = 2·cell·K + gap; h = cell·K
  const cellFromW = (perW - AVATAR_GRID_GAP) / (2 * GRID_SPAN_K);
  const cellFromH = perH / GRID_SPAN_K;
  return Math.min(cellFromW, cellFromH);
}

// Choose the arrangement (columns × rows) AND card orientation that maximizes
// the per-card cell size within the embed's max box, then size the canvas to
// wrap that content. Both orientations are always considered and the largest
// grid wins, which falls out the way you'd want: a lone board goes horizontal
// (avatar left of grid) so it fills the wider-than-tall embed; a single row of
// several players goes vertical (narrow avatar-over-grid cards pack tighter
// across); bigger groups pick whichever orientation packs largest.
function planLayout(n: number, hasSubtitle: boolean): RenderPlan {
  const contentY = TITLE_BAND_H + (hasSubtitle ? SUBTITLE_BAND_H : 0);
  const maxContentW = MAX_CANVAS_W - SIDE_PAD * 2;
  const maxContentH = MAX_CANVAS_H - contentY - BOTTOM_PAD;

  if (n <= 0) {
    return {
      width: 400,
      height: contentY + 120 + BOTTOM_PAD,
      contentY,
      cols: 0,
      rows: 0,
      orientation: "vertical",
      cell: 0,
      cellGap: 2,
      gridSide: 0,
      avatar: 0,
      blockW: 0,
      blockH: 0,
      slotW: 0,
      slotH: 0,
    };
  }

  let best = { cols: 1, rows: 1, orientation: "vertical" as CardOrientation, cell: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const orientations: CardOrientation[] = ["vertical", "horizontal"];
    for (const orientation of orientations) {
      const cell = maxCellFor(orientation, cols, rows, maxContentW, maxContentH);
      if (cell > best.cell) best = { cols, rows, orientation, cell };
    }
  }

  // Floor (never raise above what fits) so the grid can't overflow.
  const cell = Math.max(2, Math.floor(best.cell));
  const cellGap = Math.max(2, Math.round(cell * CELL_GAP_RATIO));
  const gridSide = GRID_COLS * cell + (GRID_COLS - 1) * cellGap;
  const avatar = gridSide;
  const blockW =
    best.orientation === "vertical" ? gridSide : avatar + AVATAR_GRID_GAP + gridSide;
  const blockH =
    best.orientation === "vertical" ? avatar + AVATAR_GRID_GAP + gridSide : gridSide;
  const slotW = blockW + INNER_PAD_X * 2;
  const slotH = blockH + INNER_PAD_Y * 2;
  const totalW = best.cols * slotW + (best.cols - 1) * TILE_GAP;
  const totalH = best.rows * slotH + (best.rows - 1) * TILE_GAP;
  return {
    width: Math.min(MAX_CANVAS_W, Math.max(MIN_CANVAS_W, totalW + SIDE_PAD * 2)),
    height: Math.min(MAX_CANVAS_H, contentY + totalH + BOTTOM_PAD),
    contentY,
    cols: best.cols,
    rows: best.rows,
    orientation: best.orientation,
    cell,
    cellGap,
    gridSide,
    avatar,
    blockW,
    blockH,
    slotW,
    slotH,
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

  const contentW = layout.width - SIDE_PAD * 2;

  // Draw the board at BOARD_SCALE, centered in the content region, so a single
  // board doesn't fill the whole (same-size) embed. The title stays full size.
  ctx.save();
  const centerX = layout.width / 2;
  const centerY = layout.contentY + (layout.height - layout.contentY - BOTTOM_PAD) / 2;
  ctx.translate(centerX, centerY);
  ctx.scale(BOARD_SCALE, BOARD_SCALE);
  ctx.translate(-centerX, -centerY);

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
    // (bx, by) = top-left of the content block inside the card padding.
    const bx = slotX + INNER_PAD_X;
    const by = slotY + INNER_PAD_Y;
    await drawTile(ctx, bx, by, layout, p);
  }
  ctx.restore();

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

// Draws one participant card: a rounded border around the avatar + 6×6 grid.
// "vertical" puts the avatar above the grid; "horizontal" puts it to the left.
// (bx, by) is the top-left of the content block (inside the card padding).
async function drawTile(
  ctx: SKRSContext2D,
  bx: number,
  by: number,
  plan: RenderPlan,
  p: NowPlayingImageParticipant,
): Promise<void> {
  // Rounded border around the card, padded out from the content block.
  const cardX = bx - INNER_PAD_X;
  const cardY = by - INNER_PAD_Y;
  const cardW = plan.blockW + INNER_PAD_X * 2;
  const cardH = plan.blockH + INNER_PAD_Y * 2;
  const radius = Math.min(18, Math.min(cardW, cardH) / 4);
  roundedRect(ctx, cardX, cardY, cardW, cardH, radius);
  if (TILE_BG !== "transparent") {
    ctx.fillStyle = TILE_BG;
    ctx.fill();
  }
  ctx.strokeStyle = TILE_BORDER;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (plan.orientation === "vertical") {
    // Avatar centered on top, grid centered below.
    const avatarX = bx + (plan.blockW - plan.avatar) / 2;
    await drawAvatarCircle(ctx, p.avatarUrl, avatarX, by, plan.avatar);
    const gridX = bx + (plan.blockW - plan.gridSide) / 2;
    const gridY = by + plan.avatar + AVATAR_GRID_GAP;
    drawGuessGrid(ctx, gridX, gridY, plan.cell, plan.cellGap, p.history);
    return;
  }

  // Horizontal: avatar on the left, grid on the right, both vertically centered.
  const avatarY = by + (plan.blockH - plan.avatar) / 2;
  await drawAvatarCircle(ctx, p.avatarUrl, bx, avatarY, plan.avatar);
  const gridX = bx + plan.avatar + AVATAR_GRID_GAP;
  const gridY = by + (plan.blockH - plan.gridSide) / 2;
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