import type { FastifyReply, FastifyRequest } from "fastify";
import { type DiscordUser, verifyAccessToken } from "./discord.js";
import { env } from "../env.js";

// Pulls "Bearer <token>" out of Authorization, verifies with Discord, and
// returns the user. On failure, sends 401 and returns null.
export async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<DiscordUser | null> {
  // Dev escape hatch: in non-production, accept "Bearer dev:<userId>" so the
  // game flow can be exercised end-to-end without a real Discord token.
  // The real OAuth path is still the supported one; this only activates when
  // DISCORD_CLIENT_SECRET is unset.
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    reply.code(401);
    void reply.send({ error: "Missing bearer token" });
    return null;
  }
  const token = header.slice("Bearer ".length).trim();

  if (env.NODE_ENV !== "production" && !env.DISCORD_CLIENT_SECRET && token.startsWith("dev:")) {
    const id = token.slice("dev:".length) || "dev-user";
    return { id, displayName: `Dev ${id}`, avatarUrl: null };
  }

  const user = await verifyAccessToken(token);
  if (!user) {
    reply.code(401);
    void reply.send({ error: "Invalid token" });
    return null;
  }
  return user;
}
