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

describe("renderNowPlayingImage fixed sizing (bug 4)", () => {
  it("produces an identically-sized image regardless of participant count", async () => {
    const counts = [0, 1, 2, 3, 6, 13, 24];
    const sizes = await Promise.all(
      counts.map(async (n) => {
        const participants = Array.from({ length: n }, () => participant(3));
        const buf = await renderNowPlayingImage({
          puzzleId: "2026-05-26",
          puzzleNumber: 7,
          participants,
        });
        return dimensions(buf);
      }),
    );
    const first = sizes[0]!;
    for (const s of sizes) {
      expect(s).toEqual(first);
    }
  });

  it("keeps the same size with a subtitle (recap path)", async () => {
    const noSub = dimensions(
      await renderNowPlayingImage({
        puzzleId: "2026-05-26",
        puzzleNumber: 7,
        participants: [participant(4)],
      }),
    );
    const withSub = dimensions(
      await renderNowPlayingImage({
        puzzleId: "2026-05-26",
        puzzleNumber: 7,
        participants: [participant(4)],
        subtitle: "Answer: Somebody",
      }),
    );
    // Width is always fixed; height is fixed too (the subtitle eats into the
    // content area rather than growing the canvas).
    expect(noSub.width).toBe(withSub.width);
    expect(noSub.height).toBe(withSub.height);
  });
});
