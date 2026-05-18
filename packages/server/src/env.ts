import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DB_PATH: z.string().default("./holodle.db"),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  // Where the built client lives in production (Docker copies it here).
  CLIENT_DIST: z.string().default("../client/dist"),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);

export const hasDiscordCreds = !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
