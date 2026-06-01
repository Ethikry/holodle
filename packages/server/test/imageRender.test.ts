import { describe, expect, it } from "vitest";
import type { GuessDiff } from "@holodle/shared";
import {
  renderNowPlayingImage,
  type NowPlayingImageParticipant,
} from "../src/discord/imageRender.js";

// A throwaway wrong-everywhere diff so the grid has something to draw.
function diff(): GuessDiff {
  return {
    talentId: "t",
    branch: { value: "JP", state: "wrong" },
    group: { value: "Gen 0", state: "wrong" },
    penlightColor: { value: "Blue", state: "wrong" },
    archetype: { value: "Human", state: "wrong" },
    height: { value: "Med", state: "wrong" },
    birthMonth: { value: "January", state: "wrong" },
  };
}

function participant(guesses: number): NowPlayingImageParticipant {
  return {
    avatarUrl: null, // avoids a network fetch; renderer no-ops on null
    history: Array.from({ length: guesses }, diff),
    status: "playing",
  };
}

// PNG IHDR: 8-byte signature, then a chunk whose width/height are big-endian
// 32-bit ints at byte offsets 16 and 20. No decoder dependency needed.
function dimensions(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Fixed 400×300 canvas (the embed's max display size) rendered at 4× → a clean
// 1600×1200 PNG for every participant count.
const EXPECTED_W = 1600;
const EXPECTED_H = 1200;

describe("renderNowPlayingImage sizing", () => {
  it("renders a fixed 1600×1200 image for any participant count", async () => {
    const counts = [0, 1, 2, 3, 6, 13, 24];
    for (const n of counts) {
      const participants = Array.from({ length: n }, () => participant(3));
      const buf = await renderNowPlayingImage({
        puzzleId: "2026-05-26",
        puzzleNumber: 7,
        participants,
      });
      const { width, height } = dimensions(buf);
      expect(width).toBe(EXPECTED_W);
      expect(height).toBe(EXPECTED_H);
    }
  });
});
