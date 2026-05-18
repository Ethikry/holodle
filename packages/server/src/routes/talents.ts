import type { FastifyInstance } from "fastify";
import { getRegistry } from "../game/talents.js";

// Public: anyone who has the activity can fetch the autocomplete list.
// Returns name + avatar only — NO attribute data ever leaves the server.
export async function talentsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/talents", async () => {
    return getRegistry().summaries;
  });
}
