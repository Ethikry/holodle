import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// We need the DISCORD_PUBLIC_KEY set BEFORE env.ts imports, so build the
// keypair before any server module load.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ format: "der", type: "spki" });
const pubHex = spki.subarray(spki.length - 32).toString("hex");

const tmpDir = mkdtempSync(join(tmpdir(), "holodle-interactions-"));
process.env.DB_PATH = join(tmpDir, "test.db");
process.env.NODE_ENV = "test";
process.env.DISCORD_PUBLIC_KEY = pubHex;

const fixturesDir = resolve(fileURLToPath(import.meta.url), "..", "fixtures");
const TALENTS = join(fixturesDir, "talents.json");

const { buildApp } = await import("../src/app.js");
const app = await buildApp({ talentsJsonPath: TALENTS, serveClient: false, log: false });

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function signBody(body: string, timestamp: string): string {
  const message = Buffer.concat([Buffer.from(timestamp, "utf8"), Buffer.from(body, "utf8")]);
  return sign(null, message, privateKey).toString("hex");
}

async function postInteraction(payload: unknown) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signBody(body, timestamp);
  return app.inject({
    method: "POST",
    url: "/api/interactions",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
    },
    payload: body,
  });
}

describe("POST /api/interactions", () => {
  beforeEach(() => {
    // No outbound calls allowed in these tests — every fetch is intercepted.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "msg-1", channel_id: "c1" }), { status: 200 }),
    );
  });

  it("PING returns PONG with type 1", async () => {
    const r = await postInteraction({ type: 1 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ type: 1 });
  });

  it("rejects requests without a valid signature with 401", async () => {
    const body = JSON.stringify({ type: 1 });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const r = await app.inject({
      method: "POST",
      url: "/api/interactions",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": "00".repeat(64),
        "x-signature-timestamp": timestamp,
      },
      payload: body,
    });
    expect(r.statusCode).toBe(401);
  });

  it("rejects requests with no signature headers with 401", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/interactions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ type: 1 }),
    });
    expect(r.statusCode).toBe(401);
  });

  it("Launch command returns type 12 (LAUNCH_ACTIVITY)", async () => {
    const r = await postInteraction({
      type: 2,
      application_id: "app-1",
      token: "tok-1",
      channel_id: "channel-1",
      guild_id: "guild-1",
      data: { name: "Launch" },
      member: { user: { id: "user-1", username: "alice", global_name: "Alice" } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ type: 12 });
  });

  it("rejects unsupported interaction types with 400", async () => {
    const r = await postInteraction({ type: 99 });
    expect(r.statusCode).toBe(400);
  });
});
