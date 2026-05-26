// Helpers around the interaction follow-up webhook API. These calls use the
// interaction `token` returned in the original Discord interaction payload as
// their auth — no bot token, no user OAuth. The token is valid for 15
// minutes from issue; outside that window POSTs and PATCHes return 401/404.

import type { Embed, MessageComponent } from "./embeds.js";

const DISCORD_API = "https://discord.com/api/v10";

export interface FollowupFile {
  filename: string; // also the suffix in `attachment://<filename>` on the embed
  data: Buffer;
  contentType?: string;
}

export interface FollowupPayload {
  // Plain message text rendered above the embed. We use this for the
  // "X was playing" subtitle on superseded "Now Playing" messages.
  content?: string;
  embeds?: Embed[];
  components?: MessageComponent[];
  allowed_mentions?: { parse?: string[]; users?: string[]; roles?: string[] };
  // Flags bitfield. We never set ephemeral here — the activity launch flow
  // wants public messages — but expose it so dev tooling can inspect.
  flags?: number;
  // Optional PNG (or other binary) attachments. When present, the request is
  // sent as multipart/form-data with a `payload_json` part. Each embed that
  // wants to display one references it via `attachment://<filename>`.
  files?: FollowupFile[];
  // Make this message a reply to another. Discord renders the referenced
  // message as a quoted preview above the new one. `fail_if_not_exists:
  // false` so a deleted referenced message degrades to a normal post
  // instead of failing the request.
  message_reference?: {
    message_id: string;
    fail_if_not_exists?: boolean;
  };
}

export interface PostedMessage {
  id: string;
  channel_id: string;
}

// Internal helper — encodes either JSON or multipart based on whether the
// payload carries files.
function encodeRequest(
  payload: FollowupPayload,
): { headers: Record<string, string>; body: string | FormData } {
  const { files, ...rest } = payload;
  if (!files || files.length === 0) {
    return {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rest),
    };
  }
  // Discord wants multipart/form-data with one `payload_json` part and one
  // `files[N]` part per attachment. The `attachments` array in payload_json
  // is how each file's id is exposed to embed image/thumbnail URLs (via
  // `attachment://<filename>`). On PATCH, omitting an attachment from this
  // list deletes it — we want fresh attachments each tick, so we always
  // declare exactly the files we're attaching now.
  const form = new FormData();
  const attachments = files.map((f, i) => ({ id: i, filename: f.filename }));
  form.append(
    "payload_json",
    JSON.stringify({ ...rest, attachments }),
  );
  files.forEach((f, i) => {
    const blob = new Blob([new Uint8Array(f.data)], {
      type: f.contentType ?? "application/octet-stream",
    });
    form.append(`files[${i}]`, blob, f.filename);
  });
  return { headers: {}, body: form };
}

export async function postFollowup(
  applicationId: string,
  token: string,
  payload: FollowupPayload,
  options: { wait?: boolean } = {},
): Promise<PostedMessage | null> {
  const wait = options.wait ? "?wait=true" : "";
  const url = `${DISCORD_API}/webhooks/${applicationId}/${token}${wait}`;
  const { headers, body } = encodeRequest(payload);
  try {
    const resp = await fetch(url, { method: "POST", headers, body });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      console.error(
        `[discord] postFollowup failed: ${resp.status} ${resp.statusText} — ${errBody.slice(0, 200)}`,
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
  const { headers, body } = encodeRequest(payload);
  try {
    const resp = await fetch(url, { method: "PATCH", headers, body });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      console.error(
        `[discord] patchFollowup failed: ${resp.status} ${resp.statusText} — ${errBody.slice(0, 200)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("[discord] patchFollowup threw:", err);
    return false;
  }
}
