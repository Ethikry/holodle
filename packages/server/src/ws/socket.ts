import type { FastifyInstance } from "fastify";
import { Server as IOServer } from "socket.io";
import type {
  BoardRow,
  ClientToServerEvents,
  GameStatus,
  PlayerSnapshot,
  ServerToClientEvents,
} from "@holodle/shared";
import { boardRowFromDiff } from "@holodle/shared";
import { verifyAccessToken } from "../auth/discord.js";
import { env, corsOrigins } from "../env.js";
import { listPlayers, removePlayer, upsertPlayer } from "../game/instance.js";
import { dayIndexFor, puzzleIdFor, safeTz } from "../game/dailyPicker.js";
import { loadUserDay } from "../db/client.js";
import { loadChannelBoards } from "../game/channelState.js";

type Io = IOServer<ClientToServerEvents, ServerToClientEvents>;

interface JoinedSession {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  instanceId: string;
  channelId: string | null;
  tz: string;
}

let io: Io | null = null;
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
      const nowMs = Date.now();
      const dayIndex = dayIndexFor(nowMs, validTz);
      const puzzleId = puzzleIdFor(nowMs, validTz);

      const row = loadUserDay(userId, dayIndex);
      const snapshot: PlayerSnapshot = {
        userId,
        displayName,
        avatarUrl,
        guessesUsed: row.guesses.length,
        status: row.status,
        board: row.guesses.map(boardRowFromDiff),
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

      await socket.join(instanceId);
      upsertPlayer(instanceId, snapshot);

      // Hydrate this socket with the union of:
      //   - everyone currently connected to this Discord activity instance, and
      //   - every channel participant (completed or in-progress) for the
      //     viewer's puzzle. Those are the boards the user wants to see at
      //     the start of the activity, not just live presence.
      const livePlayers = listPlayers(instanceId);
      const channelPlayers = channelId ? loadChannelBoards(channelId, puzzleId, dayIndex) : [];
      const merged = mergeSnapshots(livePlayers, channelPlayers);
      socket.emit("room:snapshot", merged);
      socket.to(instanceId).emit("player:joined", snapshot);
      ack({ ok: true });
    });

    socket.on("disconnect", () => {
      if (!joined) return;
      const session = joined;
      removePlayer(session.instanceId, session.userId);
      // biome-ignore lint/style/noNonNullAssertion: io is set before connection handler
      io!.to(session.instanceId).emit("player:left", { userId: session.userId });
    });
  });

  return io;
}

export function broadcastProgress(
  instanceId: string,
  userId: string,
  guessesUsed: number,
  status: GameStatus,
  board: BoardRow[],
): void {
  io?.to(instanceId).emit("player:progress", { userId, guessesUsed, status, board });
}

// Live presence beats the channel-day DB row (the DB lags by one guess), but
// the channel-day row carries players who aren't currently connected. Union
// them, with live data winning on conflict.
function mergeSnapshots(
  live: PlayerSnapshot[],
  channel: PlayerSnapshot[],
): PlayerSnapshot[] {
  const out = new Map<string, PlayerSnapshot>();
  for (const p of channel) out.set(p.userId, p);
  for (const p of live) out.set(p.userId, p);
  return Array.from(out.values());
}
