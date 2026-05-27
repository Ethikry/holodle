import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/requireUser.js";
import { getUserPrefs, setUserPrefs } from "../db/client.js";

// Per-user preferences. Currently:
//   - recapPingMuted: render this user as plain `displayName` in recaps
//     instead of a `<@id>` mention chip.
//   - theme:          visible-only palette id, persisted so it follows the
//                     user across devices. Validated against the allowlist
//                     below — keep in sync with client/src/themes.ts.

// The set MUST match the set declared in packages/client/src/themes.ts.
// Adding a theme requires touching both. Order is purely cosmetic here,
// but mirrors the picker order in themes.ts for readability.
export const KNOWN_THEME_IDS = [
  "sky",
  "fubuki",
  "marine",
  "suisei",
  "korone",
  "kanade",
  "su",
  "calliope",
  "gura",
  "fauna",
  "irys",
  "zeta",
] as const;

const ThemeIdSchema = z.enum(KNOWN_THEME_IDS);

// PATCH accepts partial updates so the client can flip one field at a
// time. Empty body is rejected (no-op PATCH is almost always a bug).
const PrefsPatchSchema = z
  .object({
    recapPingMuted: z.boolean().optional(),
    theme: ThemeIdSchema.optional(),
  })
  .refine(
    (v) => v.recapPingMuted !== undefined || v.theme !== undefined,
    { message: "PATCH body must include at least one field" },
  );

export async function prefsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/prefs", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return getUserPrefs(user.id);
  });

  app.patch("/api/prefs", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const parsed = PrefsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "Invalid body", details: parsed.error.flatten() };
    }
    // Merge into the existing row so partial PATCH doesn't clobber the
    // field the client didn't touch.
    const existing = getUserPrefs(user.id);
    setUserPrefs(user.id, {
      recapPingMuted: parsed.data.recapPingMuted ?? existing.recapPingMuted,
      theme: parsed.data.theme ?? existing.theme,
    });
    return getUserPrefs(user.id);
  });
}
