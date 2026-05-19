import { env, hasBotToken } from "../env.js";

// Discord REST API client — narrow to what Holodle needs (post a message
// with embeds to a channel). All calls return null on failure and log;
// they never throw back into request handlers so a Discord outage can't
// fail a /api/guess response.

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  timestamp?: string;
  thumbnail?: { url: string };
  image?: { url: string };
  fields?: DiscordEmbedField[];
  footer?: { text: string };
}

export interface MessagePayload {
  content?: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: { parse?: string[]; users?: string[]; roles?: string[] };
}

export interface PostedMessage {
  id: string;
  channel_id: string;
}

const DISCORD_API = "https://discord.com/api/v10";

export async function postChannelMessage(
  channelId: string,
  payload: MessagePayload,
): Promise<PostedMessage | null> {
  if (!hasBotToken) {
    console.warn(
      "[bot] Skipping postChannelMessage — DISCORD_BOT_TOKEN is not set. Add it to .env and restart.",
    );
    return null;
  }
  try {
    const resp = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(
        `[bot] postChannelMessage failed: ${resp.status} ${resp.statusText} — ${body.slice(0, 200)}`,
      );
      return null;
    }
    return (await resp.json()) as PostedMessage;
  } catch (err) {
    console.error("[bot] postChannelMessage threw:", err);
    return null;
  }
}
