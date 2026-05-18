import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { exchangeCode } from "../auth/discord.js";
import { hasDiscordCreds } from "../env.js";

const BodySchema = z.object({ code: z.string().min(1) });

export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/token", async (req, reply) => {
    if (!hasDiscordCreds) {
      reply.code(503);
      return { error: "Discord credentials not configured on server" };
    }
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid body", details: parsed.error.flatten() };
    }
    try {
      const tok = await exchangeCode(parsed.data.code);
      return { access_token: tok.access_token };
    } catch (err) {
      app.log.error({ err }, "OAuth code exchange failed");
      reply.code(502);
      return { error: "OAuth exchange failed" };
    }
  });
}
