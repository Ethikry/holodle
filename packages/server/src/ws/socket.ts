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
import { dayIndexFor } from "../game/dailyPicker.js";
import { loadUserDay } from "../db/client.js";

type Io = IOServer<ClientToServerEvents, ServerToClientEvents>;

let io: Io | null = null;

export function attachSocketServer(app: FastifyInstance): Io {
  if (io) return io;
  io = new IOServer<ClientToServerEvents, ServerToClientEvents>(app.server, {
    cors: { origin: corsOrigins, credentials: true },
    path: "/socket.io",
  });

  io.on("connection", (socket) => {
    let joined: { userId: string; instanceId: string } | null = null;

    socket.on("hello", async ({ accessToken, instanceId }, ack) => {
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

      // Resume their current progress from SQLite so other players see an
      // accurate snapshot the moment they join.
      const row = loadUserDay(userId, dayIndexFor());
      const snapshot: PlayerSnapshot = {
        userId,
        displayName,
        avatarUrl,
        guessesUsed: row.guesses.length,
        status: row.status,
      };

      joined = { userId, instanceId };
      await socket.join(instanceId);
      upsertPlayer(instanceId, snapshot);

      // Send the new player the current room snapshot, then announce them.
      socket.emit("room:snapshot", listPlayers(instanceId));
      socket.to(instanceId).emit("player:joined", snapshot);
      ack({ ok: true });
    });

    socket.on("disconnect", () => {
      if (!joined) return;
      const { userId, instanceId } = joined;
      removePlayer(instanceId, userId);
      // biome-ignore lint/style/noNonNullAssertion: io is set before connection handler
      io!.to(instanceId).emit("player:left", { userId });
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
