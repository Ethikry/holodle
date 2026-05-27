// Theme registry. Each entry maps a stable id (persisted via /api/prefs)
// to display metadata and the swatch colours used in the in-frame picker.
// The actual palette values live in src/styles.css under matching
// `html.theme-<id>` blocks — keep this list in lockstep with that file
// AND with the server's Zod allowlist in routes/prefs.ts.

export interface Theme {
  id: string;
  label: string;
  // Three-colour swatch shown in the Help/settings picker.
  swatch: [string, string, string];
  // Optional sub-label (the vtuber whose palette inspired this theme).
  attribution?: string;
}

export const THEMES: readonly Theme[] = [
  {
    id: "warm-pastel",
    label: "Warm Pastel",
    swatch: ["#faf5ee", "#d99b8a", "#5e8a4a"],
  },
  {
    id: "suisei",
    label: "Comet",
    attribution: "Hoshimachi Suisei",
    swatch: ["#0c1535", "#5aa7ff", "#6fe0c0"],
  },
  {
    id: "calliope",
    label: "Reaper",
    attribution: "Mori Calliope",
    swatch: ["#110a14", "#e6398f", "#c9a3ff"],
  },
  {
    id: "fauna",
    label: "Saplings",
    attribution: "Ceres Fauna",
    swatch: ["#f4ecdc", "#79a36b", "#4f8047"],
  },
  {
    id: "gura",
    label: "Tide",
    attribution: "Gawr Gura",
    swatch: ["#e6f4f5", "#f4cf5e", "#2f8aa0"],
  },
  {
    id: "marine",
    label: "Treasure",
    attribution: "Houshou Marine",
    swatch: ["#2a0a12", "#e8be5a", "#c8e08a"],
  },
];

export const DEFAULT_THEME_ID = "warm-pastel";
export const THEME_IDS: readonly string[] = THEMES.map((t) => t.id);

export function isKnownThemeId(id: string): boolean {
  return THEME_IDS.includes(id);
}

// Applies a theme to the document root. Strips any prior theme-* class
// first so themes never compound. Safe to call repeatedly with the same
// id — idempotent.
export function applyTheme(id: string): void {
  const root = document.documentElement;
  const resolved = isKnownThemeId(id) ? id : DEFAULT_THEME_ID;
  for (const klass of Array.from(root.classList)) {
    if (klass.startsWith("theme-")) root.classList.remove(klass);
  }
  root.classList.add(`theme-${resolved}`);
}
