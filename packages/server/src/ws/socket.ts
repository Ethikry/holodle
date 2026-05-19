import type { FastifyInstance } from "fastify";
import { Server as IOServer } from "socket.io";
import type {
  ClientToServerEvents,
  GameStatus,
  PlayerSnapshot,
  ServerToClientEvents,
} from "@holodle/shared";
import { verifyAccessToken } from "../auth/discord.js";
import { env, corsOrigins } from "../env.js";
import { listPlayers, removePlayer, upsertPlayer } from "../game/instance.js";
import { dayIndexFor, puzzleIdFor, safeTz } from "../game/dailyPicker.js";
import { loadUserDay, markExitEmbedPosted } from "../db/client.js";
import { getRegistry } from "../game/talents.js";
import { pickDaily } from "../game/dailyPicker.js";
import { postChannelMessage } from "../bot/client.js";
import { buildExitEmbed } from "../bot/embed.js";

type Io = IOServer<ClientToServerEvents, ServerToClientEvents>;

// Each socket carries the session bundle we need on disconnect to post the
// exit embed: the user, the activity instance, the Discord channel, and the
// user's local timezone for dayIndex computation.
interface JoinedSession {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  instanceId: string;
  channelId: string | null;
  tz: string;
}

// 30 s debounce — absorbs iframe refreshes / brief network blips so a single
// session doesn't double-post on a flicker.
const EXIT_DEBOUNCE_MS = 30_000;

let io: Io | null = null;
const pendingExitTimers = new Map<string, NodeJS.Timeout>();
const lastJoinedByUser = new Map<string, JoinedSession>();

export function attachSocketServer(app: FastifyInstance): Io {
  if (io) return io;
  io = new IOServer<ClientToServerEvents, ServerToClientEvents>(app.server, {
    cors: { origin: corsOrigins, credentials: true },
    path: "/socket.io",
  });

  io.on("connection", (socket) => {
    let joined: JoinedSession | null = null;

    socket.on("hello", async ({ accessToken, instanceId, channelId, tz }, ack) => {
      let userId: string;
      let displayName: string;
      let avatarUrl: string | null = null;

      // Dev escape hatch mirrors requireUser.ts.
      if (
        env.NODE_ENV !== "production" &&
        !env.DISCORD_CLIENT_SECRET &&
        accessToken.startsWith("dev:")
      ) {
        userId = accessToken.slice("dev:".length) || "dev-user";
        displayName = `Dev ${userId}`;
      } else {
        const user = await verifyAccessToken(accessToken);
        if (!user) {
          ack({ ok: false, error: "Invalid token" });
          socket.disconnect();
          return;
        }
        userId = user.id;
        displayName = user.displayName;
        avatarUrl = user.avatarUrl;
      }

      if (!instanceId) {
        ack({ ok: false, error: "Missing instanceId" });
        socket.disconnect();
        return;
      }

      const validTz = safeTz(tz);

      // Resume their current progress for THEIR local dayIndex so the snapshot
      // reflects whichever puzzle they're actively on.
      const row = loadUserDay(userId, dayIndexFor(Date.now(), validTz));
      const snapshot: PlayerSnapshot = {
        userId,
        displayName,
        avatarUrl,
        guessesUsed: row.guesses.length,
        status: row.status,
      };

      joined = {
        userId,
        displayName,
        avatarUrl,
        instanceId,
        channelId: channelId ?? null,
        tz: validTz,
      };
      lastJoinedByUser.set(userId, joined);

      // If we have a pending exit timer for this user (they refreshed or
      // briefly lost connection), cancel it — they're back.
      const pending = pendingExitTimers.get(userId);
      if (pending) {
        clearTimeout(pending);
        pendingExitTimers.delete(userId);
      }

      await socket.join(instanceId);
      upsertPlayer(instanceId, snapshot);

      // Send the new player the current room snapshot, then announce them.
      socket.emit("room:snapshot", listPlayers(instanceId));
      socket.to(instanceId).emit("player:joined", snapshot);
      ack({ ok: true });
    });

    socket.on("disconnect", () => {
      if (!joined) return;
      const session = joined;
      removePlayer(session.instanceId, session.userId);
      // biome-ignore lint/style/noNonNullAssertion: io is set before connection handler
      io!.to(session.instanceId).emit("player:left", { userId: session.userId });

      // Schedule the exit embed. Cleared if the user reconnects within
      // EXIT_DEBOUNCE_MS — covers iframe refresh + flaky-network bounces.
      const existing = pendingExitTimers.get(session.userId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        pendingExitTimers.delete(session.userId);
        // Only act if the user hasn't joined back in the meantime under a
        // different session pointer.
        const current = lastJoinedByUser.get(session.userId);
        if (current && current !== session) return;
        void postExitEmbed(session);
      }, EXIT_DEBOUNCE_MS);
      pendingExitTimers.set(session.userId, timer);
    });
  });

  return io;
}

export function broadcastProgress(
  instanceId: string,
  userId: string,
  guessesUsed: number,
  status: GameStatus,
): void {
  io?.to(instanceId).emit("player:progress", { userId, guessesUsed, status });
}

// Looks up the user's current day, builds the embed, and posts it. Idempotent
// via the exit_embed_posted flag on user_day.
async function postExitEmbed(session: JoinedSession): Promise<void> {
  if (!session.channelId) return;
  const now = Date.now();
  const dayIndex = dayIndexFor(now, session.tz);
  const row = loadUserDay(session.userId, dayIndex);
  if (row.exitEmbedPosted) return;
  // Skip embeds for sessions that never made a guess.
  if (row.guesses.length === 0 && row.status === "playing") return;

  let answer: { id: string; name: string; avatarUrl: string } | null = null;
  if (row.status !== "playing") {
    const reg = getRegistry();
    const t = pickDaily(reg.activePool, now, session.tz);
    if (t) answer = { id: t.id, name: t.name, avatarUrl: t.avatarUrl };
  }

  const embed = buildExitEmbed({
    userId: session.userId,
    displayName: session.displayName,
    avatarUrl: session.avatarUrl,
    history: row.guesses,
    status: row.status,
    answer,
    puzzleId: puzzleIdFor(now, session.tz),
  });

  const posted = await postChannelMessage(session.channelId, {
    embeds: [embed],
    allowed_mentions: { users: [session.userId] },
  });
  if (posted) markExitEmbedPosted(session.userId, dayIndex);
}
