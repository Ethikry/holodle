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

let session: DiscordSession | null = null;
let sessionPromise: Promise<DiscordSession | null> | null = null;

const CLIENT_ID = (import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined) ?? "";

export function isEmbeddedInDiscord(): boolean {
  // Discord injects ?frame_id=... when the activity is launched from the client.
  const params = new URLSearchParams(window.location.search);
  return params.has("frame_id");
}

export async function getDiscordSession(): Promise<DiscordSession | null> {
  if (session) return session;
  if (sessionPromise) return sessionPromise;
  if (!isEmbeddedInDiscord()) return null;
  if (!CLIENT_ID) {
    console.warn("VITE_DISCORD_CLIENT_ID is not set — Discord SDK init skipped.");
    return null;
  }

  sessionPromise = (async () => {
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
    if (!tokenResp.ok) throw new Error(`Token exchange failed: ${tokenResp.status}`);
    const { access_token } = (await tokenResp.json()) as { access_token: string };

    const auth = await sdk.commands.authenticate({ access_token });
    if (!auth?.user) throw new Error("Discord authenticate returned no user");

    // Lock portrait orientation on mobile. Best-effort — older SDK versions may not have this.
    try {
      // @ts-expect-error optional method, varies by SDK minor version
      await sdk.commands.setOrientationLockState?.({ lock_state: "portrait" });
    } catch {
      // ignore
    }

    session = {
      sdk,
      accessToken: access_token,
      instanceId: sdk.instanceId,
      user: auth.user,
    };
    return session;
  })();

  try {
    return await sessionPromise;
  } catch (err) {
    console.error("Discord SDK init failed", err);
    sessionPromise = null;
    return null;
  }
}

// Dev mode: produce a synthetic session so the game flow works in a plain
// browser (no Discord iframe). The server's requireUser accepts "dev:<id>"
// bearer tokens whenever DISCORD_CLIENT_SECRET is unset.
export function getDevSession(): DiscordSession {
  const id = `local-${Math.random().toString(36).slice(2, 8)}`;
  return {
    // The SDK is never used in dev — we cast through unknown to keep the type stable.
    sdk: null as unknown as DiscordSDK,
    accessToken: `dev:${id}`,
    instanceId: "dev-instance",
    user: { id, username: id, global_name: `Dev ${id}`, avatar: null },
  };
}
