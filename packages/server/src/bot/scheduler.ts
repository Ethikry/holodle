import {
  settledRowsBetween,
  tryClaimRecap,
  type SettledRow,
} from "../db/client.js";
import { puzzleIdFor } from "../game/dailyPicker.js";
import { postChannelMessage } from "./client.js";
import { buildRecapEmbed, type RecapPlayer } from "./embed.js";

const RECAP_TZ = "America/Chicago"; // CST/CDT — recap fires at this zone's midnight
const SAFETY_DELAY_MS = 30_000; // wait 30s past midnight so straddling clocks settle
const WINDOW_HOURS = 24;

let armed = false;

// Compute the next CST midnight in UTC ms. DST-safe: we ask Intl for the
// current Chicago date, advance by one day, then re-parse "00:00 local" by
// formatting back. Because Date.UTC of a Y/M/D combined with the timezone
// offset gets messy across DST boundaries, we use a binary-search approach:
// start with an estimate (24h from now), then nudge until the Chicago-local
// clock reads exactly 00:00 on the target date.
export function nextCstMidnightAfter(nowMs: number): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: RECAP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // Target: the next Chicago-local date at 00:00:00. Start estimate +25h
  // to avoid landing on the same date.
  const startDate = fmt.formatToParts(new Date(nowMs + 25 * 3_600_000));
  const targetY = Number.parseInt(getPart(startDate, "year"), 10);
  const targetM = Number.parseInt(getPart(startDate, "month"), 10);
  const targetD = Number.parseInt(getPart(startDate, "day"), 10);

  // Binary search across a ±26h window around the rough estimate. We pick
  // the smallest UTC ms whose Chicago-local time is exactly Y-M-D 00:00:00.
  let lo = nowMs;
  let hi = nowMs + 49 * 3_600_000;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cmp = compareChicagoLocal(mid, targetY, targetM, targetD, fmt);
    if (cmp < 0) lo = mid;
    else hi = mid;
  }
  return hi;
}

function getPart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "0";
}

// -1 if mid is before targetDay 00:00 local, 0 if exactly at, 1 if after.
function compareChicagoLocal(
  ms: number,
  targetY: number,
  targetM: number,
  targetD: number,
  fmt: Intl.DateTimeFormat,
): number {
  const parts = fmt.formatToParts(new Date(ms));
  const y = Number.parseInt(getPart(parts, "year"), 10);
  const m = Number.parseInt(getPart(parts, "month"), 10);
  const d = Number.parseInt(getPart(parts, "day"), 10);
  const hh = Number.parseInt(getPart(parts, "hour"), 10);
  const mm = Number.parseInt(getPart(parts, "minute"), 10);
  const ss = Number.parseInt(getPart(parts, "second"), 10);
  const local = y * 10_000_000_000 + m * 100_000_000 + d * 1_000_000 + hh * 10_000 + mm * 100 + ss;
  const target = targetY * 10_000_000_000 + targetM * 100_000_000 + targetD * 1_000_000;
  return Math.sign(local - target);
}

export function armDailyRecap(now: () => number = Date.now): void {
  if (armed) return;
  armed = true;
  const schedule = () => {
    const nowMs = now();
    const next = nextCstMidnightAfter(nowMs) + SAFETY_DELAY_MS;
    const delay = Math.max(0, next - nowMs);
    setTimeout(async () => {
      try {
        await runRecap(now());
      } catch (err) {
        console.error("[bot] recap fire threw:", err);
      } finally {
        schedule(); // re-arm for tomorrow regardless
      }
    }, delay).unref();
    console.log(
      `[bot] next recap scheduled for ${new Date(next).toISOString()} (in ${Math.round(delay / 1000)}s)`,
    );
  };
  schedule();
}

// Runs the recap for one fire. Idempotent per (channel_id, fireSec):
// daily_recaps insert guards against duplicate posts after restart.
export async function runRecap(nowMs: number = Date.now()): Promise<void> {
  const fireSec = Math.floor(nowMs / 1000);
  const startSec = fireSec - WINDOW_HOURS * 3600;
  const settled = settledRowsBetween(startSec, fireSec);

  // Group by channel.
  const byChannel = new Map<string, SettledRow[]>();
  for (const row of settled) {
    const arr = byChannel.get(row.channelId) ?? [];
    arr.push(row);
    byChannel.set(row.channelId, arr);
  }

  if (byChannel.size === 0) {
    console.log("[bot] recap window had no settled rows — nothing to post.");
    return;
  }

  const windowLabel = puzzleIdFor(nowMs, RECAP_TZ);

  for (const [channelId, rows] of byChannel) {
    if (!tryClaimRecap(channelId, fireSec)) {
      console.log(`[bot] recap already posted for channel ${channelId} at ${fireSec}`);
      continue;
    }
    const players: RecapPlayer[] = rows.map((r) => ({
      userId: r.userId,
      guessesUsed: r.guessesUsed,
      status: r.status,
      puzzleId: puzzleIdFor(nowMs, r.tz ?? RECAP_TZ),
    }));
    const embed = buildRecapEmbed({ windowLabel, players });
    await postChannelMessage(channelId, { embeds: [embed] });
  }
}
