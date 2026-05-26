import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "../env.js";
import { verifyInteractionSignature } from "../discord/verify.js";
import {
  buildYesterdayRecapEmbed,
  computeChannelStreak,
  findMostRecentUnpostedRecapPuzzle,
  listYesterdayRecapPlayers,
  postFollowup,
  syncChannelEmbed,
  tryClaimRecapPosted,
  upsertChannelToken,
  upsertParticipant,
} from "../game/channelState.js";
import { LAUNCH_BUTTON_CUSTOM_ID } from "../discord/embeds.js";
import { puzzleIdFor, safeTz } from "../game/dailyPicker.js";
import { getLatestUserTz } from "../db/client.js";

// Discord interaction types.
const TYPE_PING = 1;
const TYPE_APPLICATION_COMMAND = 2;
const TYPE_MESSAGE_COMPONENT = 3;
const RESPONSE_PONG = 1;
const RESPONSE_LAUNCH_ACTIVITY = 12;

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

// Channel-day puzzle id is keyed by the launching user's IANA tz so the
// embed posted at /launch matches the puzzle that user will actually play
// in /api/guess. The Discord interaction payload doesn't carry a tz, so we
// fall back to the most-recent tz this user recorded on a previous guess
// (or UTC if they've never played).
function channelPuzzleId(nowMs: number, tz: string): string {
  return puzzleIdFor(nowMs, tz);
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

    // Accept both the auto-generated Entry Point "Launch" command and a
    // hand-registered "/holodle" command. The latter is friendlier to type
    // in chat; both fire the same handler.
    if (payload.type === TYPE_APPLICATION_COMMAND) {
      const name = payload.data?.name?.toLowerCase();
      if (name === "launch" || name === "holodle") {
        // Kick off the follow-up posting asynchronously. Discord requires us
        // to respond within 3 seconds — embed posting/editing is too slow to
        // do inline. We fire-and-forget; failures are logged but never block
        // the activity launch.
        handleLaunch(payload).catch((err) => {
          req.log.error({ err }, "interaction follow-up failed");
        });
        return { type: RESPONSE_LAUNCH_ACTIVITY };
      }
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
  const tz = safeTz(getLatestUserTz(user.id) ?? undefined);
  const puzzleId = channelPuzzleId(nowMs, tz);
  const displayName = pickDisplayName(payload, user);
  const avatarUrl = pickAvatarUrl(payload, user);

  // 1) Previous-session recap (fire-and-forget, no message_id capture).
  //
  //    We used to recap strictly "yesterday in launcher's tz" — which silently
  //    disappeared if no one /launched the next day (the most common case in
  //    sparsely-played channels). Now we find the most recent puzzle in this
  //    channel that has settled plays AND hasn't been recapped yet, regardless
  //    of how many days back it is. Still idempotent via channel_recap_posted.
  const recapPuzzleId = findMostRecentUnpostedRecapPuzzle(channelId, puzzleId);
  if (recapPuzzleId) {
    const players = listYesterdayRecapPlayers(channelId, recapPuzzleId);
    if (players.length > 0 && tryClaimRecapPosted(channelId, recapPuzzleId)) {
      const streak = computeChannelStreak(channelId, recapPuzzleId);
      const { embed, file, content } = await buildYesterdayRecapEmbed({
        puzzleId: recapPuzzleId,
        players,
        streak,
      });
      try {
        await postFollowup(applicationId, token, {
          content,
          embeds: [embed],
          files: [file],
          // Mention user IDs in the content for visibility, but suppress
          // notifications so the recap doesn't ping the entire channel
          // every time it fires.
          allowed_mentions: { parse: [] },
        });
      } catch (err) {
        console.error("[interactions] recap follow-up failed:", err);
      }
    }
  }

  // 2) Refresh channel_daily_state with the new token before any posting —
  //    that way recordParticipantProgress calls from /api/guess will use
  //    the latest one immediately.
  upsertChannelToken(channelId, puzzleId, token, applicationId);

  // 3) Register this user as a participant (idempotent — keeps their progress).
  upsertParticipant({
    channelId,
    puzzleId,
    userId: user.id,
    displayName,
    avatarUrl,
  });

  // 4) Defer the actual embed write to syncChannelEmbed. We do NOT pass
  //    allowSupersede here — a "Play now!" click (or /launch / /holodle)
  //    is a passive open of the activity, not a board edit. Even when the
  //    existing message is hours old, we just PATCH it in place; only an
  //    actual guess will produce a fresh reply embed (see
  //    recordParticipantProgress).
  try {
    await syncChannelEmbed(channelId, puzzleId);
  } catch (err) {
    console.error("[interactions] syncChannelEmbed failed:", err);
  }
}

const RAW_BODY_SYMBOL = Symbol.for("holodle.rawBody");

function headerString(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  if (typeof v === "string") return v;
  return null;
}
