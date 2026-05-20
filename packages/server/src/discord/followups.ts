// Helpers around the interaction follow-up webhook API. These calls use the
// interaction `token` returned in the original Discord interaction payload as
// their auth — no bot token, no user OAuth. The token is valid for 15
// minutes from issue; outside that window POSTs and PATCHes return 401/404.

import type { Embed, MessageComponent } from "./embeds.js";

const DISCORD_API = "https://discord.com/api/v10";

export interface FollowupPayload {
  embeds?: Embed[];
  components?: MessageComponent[];
  allowed_mentions?: { parse?: string[]; users?: string[]; roles?: string[] };
  // Flags bitfield. We never set ephemeral here — the activity launch flow
  // wants public messages — but expose it so dev tooling can inspect.
  flags?: number;
}

export interface PostedMessage {
  id: string;
  channel_id: string;
}

export async function postFollowup(
  applicationId: string,
  token: string,
  payload: FollowupPayload,
  options: { wait?: boolean } = {},
): Promise<PostedMessage | null> {
  const wait = options.wait ? "?wait=true" : "";
  const url = `${DISCORD_API}/webhooks/${applicationId}/${token}${wait}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(
        `[discord] postFollowup failed: ${resp.status} ${resp.statusText} — ${body.slice(0, 200)}`,
      );
      return null;
    }
    if (!options.wait) return null;
    return (await resp.json()) as PostedMessage;
  } catch (err) {
    console.error("[discord] postFollowup threw:", err);
    return null;
  }
}

export async function patchFollowup(
  applicationId: string,
  token: string,
  messageId: string,
  payload: FollowupPayload,
): Promise<boolean> {
  const url = `${DISCORD_API}/webhooks/${applicationId}/${token}/messages/${messageId}`;
  try {
    const resp = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(
        `[discord] patchFollowup failed: ${resp.status} ${resp.statusText} — ${body.slice(0, 200)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("[discord] patchFollowup threw:", err);
    return false;
  }
}
