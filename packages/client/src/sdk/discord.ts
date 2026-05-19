import { DiscordSDK } from "@discord/embedded-app-sdk";

// Singleton handles for the SDK and the access token issued by Discord. The
// activity iframe receives client_id and instanceId via the launch params;
// the access token is acquired via OAuth code exchange handled server-side.

export interface DiscordSession {
  sdk: DiscordSDK;
  accessToken: string;
  instanceId: string;
  user: { id: string; username: string; global_name?: string | null; avatar?: string | null };
}

export type SessionResult =
  | { ok: true; session: DiscordSession }
  | { ok: false; reason: string };

// The Discord SDK frequently throws plain objects ({ code, message }) rather
// than Error instances, so String(err) yields "[object Object]" and hides the
// actual failure. Stringify defensively so the UI banner shows useful text.
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    // Pull out shape from common SDK error envelopes first.
    const e = err as { code?: number | string; message?: string; error?: string };
    if (e.message || e.code !== undefined || e.error) {
      const code = e.code !== undefined ? `[${e.code}] ` : "";
      const msg = e.message ?? e.error ?? "";
      if (msg) return `${code}${msg}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

let cached: DiscordSession | null = null;
let inflight: Promise<SessionResult> | null = null;

const CLIENT_ID = (import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined) ?? "";

export function isEmbeddedInDiscord(): boolean {
  // Discord injects ?frame_id=... when the activity is launched from the client.
  const params = new URLSearchParams(window.location.search);
  return params.has("frame_id");
}

export async function getDiscordSession(): Promise<SessionResult> {
  if (cached) return { ok: true, session: cached };
  if (inflight) return inflight;
  if (!isEmbeddedInDiscord()) {
    return { ok: false, reason: "Not embedded in a Discord activity (no frame_id in URL)." };
  }
  if (!CLIENT_ID) {
    return {
      ok: false,
      reason:
        "VITE_DISCORD_CLIENT_ID is not set in the build. Put it in the repo-root .env and restart Vite.",
    };
  }

  inflight = (async (): Promise<SessionResult> => {
    try {
      const sdk = new DiscordSDK(CLIENT_ID);
      await sdk.ready();

      const { code } = await sdk.commands.authorize({
        client_id: CLIENT_ID,
        response_type: "code",
        state: "",
        prompt: "none",
        scope: ["identify", "guilds.members.read"],
      });

      const tokenResp = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const tokenBody = await tokenResp.text();
      if (!tokenResp.ok) {
        if (tokenBody.trimStart().startsWith("<")) {
          return {
            ok: false,
            reason: `/api/token returned an HTML error page (status ${tokenResp.status}). Is the Fastify server on :3001 running?`,
          };
        }
        return {
          ok: false,
          reason: `Token exchange failed (${tokenResp.status}): ${tokenBody || "see server logs"}.`,
        };
      }
      if (tokenBody.trimStart().startsWith("<")) {
        return {
          ok: false,
          reason:
            "/api/token returned HTML instead of JSON. The Fastify server on :3001 is probably not running — restart `pnpm dev` and confirm you see '... talents loaded' in the server logs.",
        };
      }
      let access_token: string;
      try {
        access_token = (JSON.parse(tokenBody) as { access_token: string }).access_token;
      } catch (err) {
        return {
          ok: false,
          reason: `/api/token returned invalid JSON: ${describeError(err)}`,
        };
      }

      const auth = await sdk.commands.authenticate({ access_token });
      if (!auth?.user) {
        return { ok: false, reason: "Discord authenticate returned no user." };
      }

      try {
        // @ts-expect-error optional method, varies by SDK minor version
        await sdk.commands.setOrientationLockState?.({ lock_state: "portrait" });
      } catch {
        // ignore — mobile-only, may not exist in all SDK versions
      }

      cached = { sdk, accessToken: access_token, instanceId: sdk.instanceId, user: auth.user };
      return { ok: true, session: cached };
    } catch (err) {
      console.error("Discord SDK init threw:", err);
      return { ok: false, reason: `Discord SDK init threw: ${describeError(err)}` };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

// Dev mode: produce a synthetic session so the game flow works in a plain
// browser (no Discord iframe). The server's requireUser accepts "dev:<id>"
// bearer tokens whenever DISCORD_CLIENT_SECRET is unset.
export function getDevSession(): DiscordSession {
  const id = `local-${Math.random().toString(36).slice(2, 8)}`;
  return {
    sdk: null as unknown as DiscordSDK,
    accessToken: `dev:${id}`,
    instanceId: "dev-instance",
    user: { id, username: id, global_name: `Dev ${id}`, avatar: null },
  };
}
