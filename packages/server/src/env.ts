import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load the repo-root .env BEFORE reading process.env. Node 20.12+ exposes
// process.loadEnvFile (stable in Node 22+); fall back to a tiny parser for
// older runtimes. Existing process.env values always win over the file —
// that matches dotenv semantics and means Fly secrets/Docker `-e` keep
// working unchanged.
const __dirname = dirname(fileURLToPath(import.meta.url));
// In dev (tsx)  : __dirname === packages/server/src   → ../../../.env
// In prod build: __dirname === packages/server/dist  → ../../../.env
const envPath = resolve(__dirname, "../../../.env");

// Skip the .env load entirely under NODE_ENV=test so unit tests can set up
// their own isolated env (e.g. unset DISCORD_CLIENT_SECRET to enable the
// dev: token escape hatch).
if (process.env.NODE_ENV !== "test" && existsSync(envPath)) {
  const loader = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
  if (typeof loader === "function") {
    try {
      loader.call(process, envPath);
    } catch {
      // ignore — process.env values from the parent process are the fallback
    }
  }
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DB_PATH: z.string().default("./holodle.db"),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  // Bot user token (separate from the OAuth client secret). Needed to post
  // the exit and recap embeds via the Discord REST API. Optional in dev —
  // when absent the bot module no-ops and logs a warning at boot.
  DISCORD_BOT_TOKEN: z.string().optional(),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  // Where the built client lives in production (Docker copies it here).
  CLIENT_DIST: z.string().default("../client/dist"),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);

export const hasDiscordCreds = !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);

export const hasBotToken = !!env.DISCORD_BOT_TOKEN;
