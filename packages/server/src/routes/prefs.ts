import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/requireUser.js";
import { getUserPrefs, setUserPrefs } from "../db/client.js";

// Per-user preferences. Currently a single flag (`recapPingMuted`) that
// controls whether daily-recap content renders this user as a `<@id>`
// mention chip or as a plain `displayName`. The endpoint shape is
// designed to grow — more bool fields can land here without a new route.

const PrefsBodySchema = z.object({
  recapPingMuted: z.boolean(),
});

export async function prefsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/prefs", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return getUserPrefs(user.id);
  });

  app.patch("/api/prefs", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = PrefsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid body", details: parsed.error.flatten() };
    }
    setUserPrefs(user.id, parsed.data);
    // Echo the persisted state so the client can sync without a follow-up GET.
    return getUserPrefs(user.id);
  });
}
