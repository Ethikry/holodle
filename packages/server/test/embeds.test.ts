import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// env.ts reads process.env at import time. We don't touch any DB here,
// but buildYesterdayRecapEmbed pulls in the dailyPicker → env chain, so
// set a temp DB_PATH defensively.
const tmpDir = mkdtempSync(join(tmpdir(), "holodle-embeds-test-"));
process.env.DB_PATH = join(tmpDir, "test.db");
process.env.NODE_ENV = "test";

// Stub the image renderer — these tests are about the text content of
// the recap, not the composited PNG. Without this, importing embeds.ts
// would pull in @napi-rs/canvas.
vi.mock("../src/discord/imageRender.js", () => ({
  renderNowPlayingImage: vi.fn(async () => Buffer.from([0])),
}));

const { buildYesterdayRecapEmbed, escapeDiscordMention } = await import(
  "../src/discord/embeds.js"
);

interface RecapPlayerInput {
  userId: string;
  displayName: string;
  guessesUsed: number;
  status: "won" | "lost" | "playing"; // <-- Added "playing" here
}

function recapPlayer(p: RecapPlayerInput): {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  guessesUsed: number;
  history: never[];
  status: "won" | "lost" | "playing"; // <-- Added "playing" here
} {
  return {
    userId: p.userId,
    displayName: p.displayName,
    avatarUrl: null,
    guessesUsed: p.guessesUsed,
    history: [],
    status: p.status,
  };
}

describe("escapeDiscordMention", () => {
  const ZWS = "​"; // zero-width space inserted by the escaper
  it("inserts a zero-width space before @, #, < so Discord's parser breaks", () => {
    // The literal trigger character is preserved (so the name still reads
    // as "@everyone") but is now prefixed with a zero-width space, which
    // is enough to break Discord's mention parser.
    expect(escapeDiscordMention("@everyone")).toBe(`${ZWS}@everyone`);
    expect(escapeDiscordMention("#general")).toBe(`${ZWS}#general`);
    // Both `<` and `@` are trigger chars, so each gets prefixed.
    expect(escapeDiscordMention("<@123>")).toBe(`${ZWS}<${ZWS}@123>`);
    // No raw "@everyone" sequence (unprefixed) survives.
    expect(/(^|[^​])@everyone/.test(escapeDiscordMention("@everyone"))).toBe(false);
  });
  it("leaves names without trigger characters unchanged", () => {
    expect(escapeDiscordMention("Alice")).toBe("Alice");
    expect(escapeDiscordMention("Ookami Mio")).toBe("Ookami Mio");
  });
});

describe("buildYesterdayRecapEmbed content (mention vs plain-text)", () => {
  it("renders every player as <@id> by default", async () => {
    const { content } = await buildYesterdayRecapEmbed({
      puzzleId: "2026-05-26",
      players: [
        recapPlayer({ userId: "u-alice", displayName: "Alice", guessesUsed: 3, status: "won" }),
        recapPlayer({ userId: "u-bob", displayName: "Bob", guessesUsed: 6, status: "lost" }),
      ] as any,
    });
    expect(content).toContain("<@u-alice>");
    expect(content).toContain("<@u-bob>");
  });

  it("renders muted users by their plain displayName instead of <@id>", async () => {
    const { content } = await buildYesterdayRecapEmbed({
      puzzleId: "2026-05-26",
      players: [
        recapPlayer({ userId: "u-alice", displayName: "Alice", guessesUsed: 3, status: "won" }),
        recapPlayer({ userId: "u-bob", displayName: "Bob", guessesUsed: 6, status: "lost" }),
      ] as any,
      mutedUserIds: new Set(["u-bob"]),
    });
    // Bob is muted: plain "Bob" appears, "<@u-bob>" does not.
    expect(content).toContain("Bob");
    expect(content).not.toContain("<@u-bob>");
    // Alice is not muted — chip preserved.
    expect(content).toContain("<@u-alice>");
  });

  it("escapes hostile displayNames so a muted user can't fake another mention", async () => {
    const { content } = await buildYesterdayRecapEmbed({
      puzzleId: "2026-05-26",
      players: [
        recapPlayer({
          userId: "u-evil",
          displayName: "@everyone",
          guessesUsed: 4,
          status: "won",
        }),
      ] as any,
      mutedUserIds: new Set(["u-evil"]),
    });
    // The literal "@everyone" string is broken by a zero-width space, so
    // Discord's parser won't recognize it as a mention.
    expect(content).not.toMatch(/(^|[^​])@everyone/);
  });

  it("renders both buckets (wins by count + losses) with the correct mention type per user", async () => {
    const { content } = await buildYesterdayRecapEmbed({
      puzzleId: "2026-05-26",
      players: [
        recapPlayer({ userId: "u-1", displayName: "One", guessesUsed: 3, status: "won" }),
        recapPlayer({ userId: "u-2", displayName: "Two", guessesUsed: 5, status: "won" }),
        recapPlayer({ userId: "u-3", displayName: "Three", guessesUsed: 6, status: "lost" }),
      ] as any,
      mutedUserIds: new Set(["u-2"]),
    });
    expect(content).toContain("<@u-1>");
    expect(content).not.toContain("<@u-2>");
    expect(content).toContain("Two");
    expect(content).toContain("<@u-3>");
    // Crown still appears for the lowest-guess bucket.
    expect(content).toContain("👑");
  });
});

const { buildActiveContent } = await import("../src/discord/embeds.js");

describe("buildActiveContent", () => {
  it("renders live-updating play context correctly based on participant counts", () => {
    // 1 Player
    expect(
      buildActiveContent([
        recapPlayer({ userId: "u-1", displayName: "Alice", guessesUsed: 2, status: "won" }),
      ])
    ).toBe("Alice is currently playing");

    // 2 Players
    expect(
      buildActiveContent([
        recapPlayer({ userId: "u-1", displayName: "Alice", guessesUsed: 2, status: "won" }),
        recapPlayer({ userId: "u-2", displayName: "Bob", guessesUsed: 4, status: "playing" }),
      ])
    ).toBe("Bob and Alice are currently playing"); // Bob sorted first since 4 > 2

    // 3 Players
    expect(
      buildActiveContent([
        recapPlayer({ userId: "u-1", displayName: "Alice", guessesUsed: 2, status: "won" }),
        recapPlayer({ userId: "u-2", displayName: "Bob", guessesUsed: 4, status: "playing" }),
        recapPlayer({ userId: "u-3", displayName: "Charlie", guessesUsed: 1, status: "playing" }),
      ])
    ).toBe("Bob and 2 others are currently playing");
  });
});