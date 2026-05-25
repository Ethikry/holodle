import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "../env.js";
import { verifyInteractionSignature } from "../discord/verify.js";
import {
  buildNowPlayingEmbed,
  buildYesterdayRecapEmbed,
  getChannelState,
  isRecapPosted,
  listParticipants,
  listYesterdayRecapPlayers,
  postFollowup,
  setChannelMessageId,
  tryClaimRecapPosted,
  upsertChannelToken,
  upsertParticipant,
} from "../game/channelState.js";
import { LAUNCH_BUTTON_CUSTOM_ID } from "../discord/embeds.js";
import { puzzleIdFor } from "../game/dailyPicker.js";
import { patchFollowup } from "../discord/followups.js";

// Discord interaction types.
const TYPE_PING = 1;
const TYPE_APPLICATION_COMMAND = 2;
const TYPE_MESSAGE_COMPONENT = 3;
const RESPONSE_PONG = 1;
const RESPONSE_LAUNCH_ACTIVITY = 12;
const ONE_DAY_MS = 86_400_000;

interface InteractionUser {
  id: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  discriminator?: string;
}

interface InteractionMember {
  user?: InteractionUser;
  nick?: string | null;
  avatar?: string | null; // per-guild avatar override
}

interface InteractionPayload {
  type: number;
  application_id?: string;
  token?: string;
  channel_id?: string;
  guild_id?: string | null;
  data?: { name?: string; custom_id?: string; component_type?: number };
  member?: InteractionMember;
  user?: InteractionUser;
}

function pickUser(p: InteractionPayload): InteractionUser | null {
  return p.member?.user ?? p.user ?? null;
}

function pickDisplayName(p: InteractionPayload, user: InteractionUser): string {
  return (
    p.member?.nick ||
    user.global_name ||
    user.username ||
    user.id
  );
}

// Build a Discord CDN avatar URL from the interaction payload. Prefers the
// per-guild member avatar, falls back to the user's global avatar, then to
// Discord's default (embed) avatar so the renderer always has something.
function pickAvatarUrl(p: InteractionPayload, user: InteractionUser): string {
  const guildId = p.guild_id ?? null;
  const guildAvatar = p.member?.avatar ?? null;
  if (guildAvatar && guildId) {
    const ext = guildAvatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${guildAvatar}.${ext}?size=256`;
  }
  if (user.avatar) {
    const ext = user.avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=256`;
  }
  // No custom avatar set. Discord computes the default-avatar index from the
  // snowflake (new-username system) or the discriminator (legacy).
  const idx =
    user.discriminator && user.discriminator !== "0"
      ? Number(user.discriminator) % 5
      : Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

// Channel-day puzzle id is UTC-anchored so two viewers in different
// timezones see the same channel embed. Per-user puzzles still use the
// user's own tz inside /api/guess.
function channelPuzzleId(nowMs: number): string {
  return puzzleIdFor(nowMs, "UTC");
}
function channelYesterdayId(nowMs: number): string {
  return puzzleIdFor(nowMs - ONE_DAY_MS, "UTC");
}

export async function interactionsRoutes(app: FastifyInstance): Promise<void> {
  // Override the JSON body parser for this route only so we keep raw bytes
  // for Ed25519 verification. Without `parseAs: 'buffer'`, Fastify hands us
  // a parsed object whose re-serialization is not byte-stable.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      // Body is delivered as Buffer; expose it on the request via a symbol so
      // the handler can re-read it after Fastify hands back the parsed JSON.
      try {
        const raw = body as Buffer;
        const parsed = raw.length === 0 ? {} : JSON.parse(raw.toString("utf8"));
        // Stash the raw buffer on the parsed value so the handler can pluck
        // it without a second body read.
        Object.defineProperty(parsed, RAW_BODY_SYMBOL, {
          value: raw,
          enumerable: false,
        });
        done(null, parsed);
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)), undefined);
      }
    },
  );

  app.post("/api/interactions", async (req, reply) => {
    const signature = headerString(req, "x-signature-ed25519");
    const timestamp = headerString(req, "x-signature-timestamp");
    const body = req.body as Record<string | symbol, unknown>;
    const rawBody = body?.[RAW_BODY_SYMBOL] as Buffer | undefined;

    if (!env.DISCORD_PUBLIC_KEY) {
      req.log.error("DISCORD_PUBLIC_KEY missing — refusing interaction");
      reply.code(401);
      return { error: "Server not configured" };
    }
    if (!signature || !timestamp || !rawBody) {
      reply.code(401);
      return { error: "Missing signature headers" };
    }
    const ok = verifyInteractionSignature({
      rawBody,
      signature,
      timestamp,
      publicKey: env.DISCORD_PUBLIC_KEY,
    });
    if (!ok) {
      reply.code(401);
      return { error: "Invalid request signature" };
    }

    const payload = body as unknown as InteractionPayload;

    if (payload.type === TYPE_PING) {
      return { type: RESPONSE_PONG };
    }

    if (
      payload.type === TYPE_APPLICATION_COMMAND &&
      payload.data?.name?.toLowerCase() === "launch"
    ) {
      // Kick off the follow-up posting asynchronously. Discord requires us
      // to respond within 3 seconds — embed posting/editing is too slow to
      // do inline. We fire-and-forget; failures are logged but never block
      // the activity launch.
      handleLaunch(payload).catch((err) => {
        req.log.error({ err }, "interaction follow-up failed");
      });
      return { type: RESPONSE_LAUNCH_ACTIVITY };
    }

    // Blue "Play now!" button — same launch flow as the /launch command. We
    // still want to record this clicker as a participant so they show up in
    // the embed grid the next time it patches.
    if (
      payload.type === TYPE_MESSAGE_COMPONENT &&
      payload.data?.custom_id === LAUNCH_BUTTON_CUSTOM_ID
    ) {
      handleLaunch(payload).catch((err) => {
        req.log.error({ err }, "button launch follow-up failed");
      });
      return { type: RESPONSE_LAUNCH_ACTIVITY };
    }

    reply.code(400);
    return { error: "Unsupported interaction" };
  });
}

async function handleLaunch(payload: InteractionPayload): Promise<void> {
  const applicationId = payload.application_id;
  const token = payload.token;
  const channelId = payload.channel_id;
  if (!applicationId || !token || !channelId) return;
  const user = pickUser(payload);
  if (!user) return;

  const nowMs = Date.now();
  const puzzleId = channelPuzzleId(nowMs);
  const yesterdayId = channelYesterdayId(nowMs);
  const displayName = pickDisplayName(payload, user);
  const avatarUrl = pickAvatarUrl(payload, user);

  // 1) Yesterday's recap (fire-and-forget, no message_id capture).
  if (!isRecapPosted(channelId, yesterdayId)) {
    const players = listYesterdayRecapPlayers(channelId, yesterdayId);
    if (players.length > 0 && tryClaimRecapPosted(channelId, yesterdayId)) {
      const { embed, file } = await buildYesterdayRecapEmbed({
        puzzleId: yesterdayId,
        players,
      });
      try {
        await postFollowup(applicationId, token, { embeds: [embed], files: [file] });
      } catch (err) {
        console.error("[interactions] recap follow-up failed:", err);
      }
    }
  }

  // 2) Refresh channel_daily_state with the new token before any posting —
  //    that way recordCompletion calls from /api/guess will use the latest
  //    one immediately.
  const state = upsertChannelToken(channelId, puzzleId, token, applicationId);

  // 3) Register this user as a participant (idempotent — keeps their progress).
  upsertParticipant({
    channelId,
    puzzleId,
    userId: user.id,
    displayName,
    avatarUrl,
  });

  const participants = listParticipants(channelId, puzzleId);
  const { embed, components, file } = await buildNowPlayingEmbed({
    puzzleId,
    participants,
    applicationId,
  });

  if (!state.messageId) {
    try {
      const posted = await postFollowup(
        applicationId,
        token,
        { embeds: [embed], components, files: [file] },
        { wait: true },
      );
      if (posted) setChannelMessageId(channelId, puzzleId, posted.id);
    } catch (err) {
      console.error("[interactions] now-playing post failed:", err);
    }
  } else {
    try {
      await patchFollowup(applicationId, token, state.messageId, {
        embeds: [embed],
        components,
        files: [file],
      });
    } catch (err) {
      console.error("[interactions] now-playing patch failed:", err);
    }
  }
}

const RAW_BODY_SYMBOL = Symbol.for("holodle.rawBody");

function headerString(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  if (typeof v === "string") return v;
  return null;
}
