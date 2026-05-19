import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  PlayerSnapshot,
  ServerToClientEvents,
} from "@holodle/shared";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface SocketHandlers {
  onSnapshot: (players: PlayerSnapshot[]) => void;
  onJoin: (p: PlayerSnapshot) => void;
  onProgress: (p: { userId: string; guessesUsed: number; status: PlayerSnapshot["status"] }) => void;
  onLeave: (p: { userId: string }) => void;
}

export function connectSocket(
  accessToken: string,
  instanceId: string,
  channelId: string | null,
  tz: string,
  handlers: SocketHandlers,
): GameSocket {
  // socket.io-client auto-resolves the origin and uses the proxied /socket.io path.
  const socket: GameSocket = io({
    path: "/socket.io",
    transports: ["websocket"],
  });

  socket.on("connect", () => {
    socket.emit("hello", { accessToken, instanceId, channelId, tz }, (ack) => {
      if (!ack.ok) {
        console.error("Socket hello rejected", ack.error);
        socket.disconnect();
      }
    });
  });

  socket.on("room:snapshot", handlers.onSnapshot);
  socket.on("player:joined", handlers.onJoin);
  socket.on("player:progress", handlers.onProgress);
  socket.on("player:left", handlers.onLeave);

  return socket;
}
