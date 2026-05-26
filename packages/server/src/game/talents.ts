import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Talent, TalentSummary } from "@holodle/shared";

const BranchSchema = z.enum(["JP", "ID", "EN", "DEV_IS", "Stars"]);
const MonthSchema = z.enum([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);

// Allow either a plain string or a non-empty array of strings. Used for
// generation + archetype so multi-group talents (Fubuki, Nerissa) can list
// every applicable label and match a guess against any of them.
const StringOrList = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).nonempty(),
]);

const TalentSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be lowercase-kebab"),
  name: z.string().min(1),
  avatarUrl: z.string().min(1),
  branch: BranchSchema,
  // Free-form group label — "Gen 0", "GAMERS", "Promise", "Regloss", …
  generation: StringOrList,
  // Debut year is no longer used for diffing (penlight color replaced it),
  // but we keep the column so a revert is one schema swap away.
  debutYear: z.number().int().min(2000).max(2100),
  archetype: StringOrList,
  // Hololive 7th fes penlight color. `null` for talents with no assigned color.
  penlightColor: z.string().min(1).nullable(),
  heightCm: z.number().int().positive(),
  birthMonth: MonthSchema,
  active: z.boolean(),
});

const TalentArraySchema = z.array(TalentSchema);

export interface TalentRegistry {
  all: Talent[];
  activePool: Talent[];
  byId: Map<string, Talent>;
  summaries: TalentSummary[];
}

let registry: TalentRegistry | null = null;

export function loadTalents(jsonPath: string): TalentRegistry {
  const absPath = resolve(jsonPath);
  const raw = readFileSync(absPath, "utf8");
  const parsed = JSON.parse(raw);
  const all = TalentArraySchema.parse(parsed);

  // ID uniqueness check
  const seen = new Set<string>();
  for (const t of all) {
    if (seen.has(t.id)) {
      throw new Error(`Duplicate talent id in ${absPath}: ${t.id}`);
    }
    seen.add(t.id);
  }

  const activePool = all.filter((t) => t.active);
  const byId = new Map(all.map((t) => [t.id, t]));
  const summaries: TalentSummary[] = all.map((t) => ({
    id: t.id,
    name: t.name,
    avatarUrl: t.avatarUrl,
  }));

  registry = { all, activePool, byId, summaries };
  return registry;
}

export function getRegistry(): TalentRegistry {
  if (!registry) throw new Error("Talent registry not initialized. Call loadTalents() first.");
  return registry;
}
