import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// env.ts reads process.env at import time, so set env before any server
// module loads. No DISCORD_CLIENT_SECRET → requireUser's dev escape hatch
// is live; "Bearer dev:<id>" authenticates as user `<id>`.
const tmpDir = mkdtempSync(join(tmpdir(), "holodle-prefs-test-"));
process.env.DB_PATH = join(tmpDir, "test.db");
process.env.NODE_ENV = "test";

const fixturesDir = resolve(fileURLToPath(import.meta.url), "..", "fixtures");
const TALENTS = join(fixturesDir, "talents.json");

const { buildApp } = await import("../src/app.js");

const app = await buildApp({ talentsJsonPath: TALENTS, serveClient: false, log: false });

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function authFor(userId: string): { Authorization: string } {
  return { Authorization: `Bearer dev:${userId}` };
}

describe("GET /api/prefs", () => {
  it("returns the default { recapPingMuted: false } for a user with no row", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/prefs",
      headers: authFor("first-load-user"),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ recapPingMuted: false, theme: "sky" });
  });

  it("rejects unauthenticated requests with 401", async () => {
    const r = await app.inject({ method: "GET", url: "/api/prefs" });
    expect(r.statusCode).toBe(401);
  });
});

describe("PATCH /api/prefs", () => {
  it("persists recapPingMuted=true and a subsequent GET reflects it", async () => {
    const userHeaders = authFor("patch-true-user");
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      headers: userHeaders,
      payload: { recapPingMuted: true },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toEqual({ recapPingMuted: true, theme: "sky" });

    const get = await app.inject({
      method: "GET",
      url: "/api/prefs",
      headers: userHeaders,
    });
    expect(get.json()).toEqual({ recapPingMuted: true, theme: "sky" });
  });

  it("toggles back to false on a second PATCH", async () => {
    const userHeaders = authFor("toggle-back-user");
    await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      headers: userHeaders,
      payload: { recapPingMuted: true },
    });
    const second = await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      headers: userHeaders,
      payload: { recapPingMuted: false },
    });
    expect(second.json()).toEqual({ recapPingMuted: false, theme: "sky" });
  });

  it("rejects body validation errors with 400", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      headers: authFor("bad-body-user"),
      // recapPingMuted must be a boolean.
      payload: { recapPingMuted: "yes" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      payload: { recapPingMuted: true },
    });
    expect(r.statusCode).toBe(401);
  });

  it("stores prefs per-user (one user's mute doesn't affect another)", async () => {
    await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      headers: authFor("isolated-a"),
      payload: { recapPingMuted: true },
    });
    const otherUser = await app.inject({
      method: "GET",
      url: "/api/prefs",
      headers: authFor("isolated-b"),
    });
    expect(otherUser.json()).toEqual({ recapPingMuted: false, theme: "sky" });
  });
});

describe("PATCH /api/prefs theme", () => {
  it("persists a known theme id and a subsequent GET reflects it", async () => {
    const userHeaders = authFor("theme-suisei-user");
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      headers: userHeaders,
      payload: { theme: "suisei" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toEqual({ recapPingMuted: false, theme: "suisei" });

    const get = await app.inject({
      method: "GET",
      url: "/api/prefs",
      headers: userHeaders,
    });
    expect(get.json()).toEqual({ recapPingMuted: false, theme: "suisei" });
  });

  it("rejects an unknown theme id with 400", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      headers: authFor("theme-bad-user"),
      payload: { theme: "definitely-not-a-real-theme" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("partial PATCH (theme only) preserves recapPingMuted", async () => {
    const userHeaders = authFor("partial-patch-user");
    // First, set recapPingMuted=true.
    await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      headers: userHeaders,
      payload: { recapPingMuted: true },
    });
    // Then, PATCH only theme.
    const themePatch = await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      headers: userHeaders,
      payload: { theme: "calliope" },
    });
    expect(themePatch.json()).toEqual({ recapPingMuted: true, theme: "calliope" });
  });

  it("partial PATCH (recapPingMuted only) preserves theme", async () => {
    const userHeaders = authFor("partial-patch-user-2");
    await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      headers: userHeaders,
      payload: { theme: "fauna" },
    });
    const togglePatch = await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      headers: userHeaders,
      payload: { recapPingMuted: true },
    });
    expect(togglePatch.json()).toEqual({ recapPingMuted: true, theme: "fauna" });
  });

  it("rejects an empty PATCH body with 400", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: "/api/prefs",
      headers: authFor("empty-patch-user"),
      payload: {},
    });
    expect(r.statusCode).toBe(400);
  });
});
