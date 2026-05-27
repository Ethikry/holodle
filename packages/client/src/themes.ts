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

// Order matters — this is the order swatches appear in the picker.
// "sky" (the original holodle palette) is listed first as the default.
// The remaining 11 are talent-anchored palettes spanning JP, DEV_IS,
// EN, and ID branches.
export const THEMES: readonly Theme[] = [
  {
    id: "sky",
    label: "Sky",
    swatch: ["#eef3fb", "#22b8e6", "#1d2944"],
  },
  {
    id: "fubuki",
    label: "Foxy",
    attribution: "Shirakami Fubuki",
    swatch: ["#ebfaf8", "#4fc8c4", "#5ca86e"],
  },
  {
    id: "marine",
    label: "Treasure",
    attribution: "Houshou Marine",
    swatch: ["#2a0a12", "#e8be5a", "#c8e08a"],
  },
  {
    id: "suisei",
    label: "Comet",
    attribution: "Hoshimachi Suisei",
    swatch: ["#0c1535", "#5aa7ff", "#d969c5"],
  },
  {
    id: "korone",
    label: "Donut",
    attribution: "Inugami Korone",
    swatch: ["#fdf5e6", "#c97b3a", "#f4cf5e"],
  },
  {
    id: "kanade",
    label: "Cadence",
    attribution: "Otonose Kanade",
    swatch: ["#fef0e8", "#ed6e83", "#8ab464"],
  },
  {
    id: "su",
    label: "Glacier",
    attribution: "Mizumiya Su",
    swatch: ["#eef8fc", "#56b4dc", "#58afa2"],
  },
  {
    id: "calliope",
    label: "Reaper",
    attribution: "Mori Calliope",
    swatch: ["#110a14", "#e6398f", "#c9a3ff"],
  },
  {
    id: "gura",
    label: "Tide",
    attribution: "Gawr Gura",
    swatch: ["#e6f4f5", "#2f8aa0", "#f4cf5e"],
  },
  {
    id: "fauna",
    label: "Saplings",
    attribution: "Ceres Fauna",
    swatch: ["#f4ecdc", "#79a36b", "#4f8047"],
  },
  {
    id: "irys",
    label: "Nephilim",
    attribution: "IRyS",
    swatch: ["#1a0a1f", "#e11d48", "#8b5cf6"],
  },
  {
    id: "zeta",
    label: "Agent",
    attribution: "Vestia Zeta",
    swatch: ["#1c122a", "#af82dc", "#ee78a5"],
  },
];

export const DEFAULT_THEME_ID = "sky";
export const THEME_IDS: readonly string[] = THEMES.map((t) => t.id);

export function isKnownThemeId(id: string): boolean {
  return THEME_IDS.includes(id);
}

// localStorage key for the last-applied theme. We persist on every
// applyTheme call so the next session can paint the loading screen in
// the user's chosen palette without waiting for /api/prefs to resolve.
const THEME_LS_KEY = "holodle-theme";

// Applies a theme to the document root. Strips any prior theme-* class
// first so themes never compound. Safe to call repeatedly with the same
// id — idempotent. Persists the resolved id to localStorage so a fresh
// page load can call applyPersistedTheme() before React mounts and the
// LoadingScreen renders in the right palette.
export function applyTheme(id: string): void {
  const root = document.documentElement;
  const resolved = isKnownThemeId(id) ? id : DEFAULT_THEME_ID;
  for (const klass of Array.from(root.classList)) {
    if (klass.startsWith("theme-")) root.classList.remove(klass);
  }
  root.classList.add(`theme-${resolved}`);
  try {
    localStorage.setItem(THEME_LS_KEY, resolved);
  } catch {
    // localStorage may be unavailable in private-mode iframes; the worst
    // case is a one-frame flash to sky when the prefs response lands.
  }
}

// Called from main.tsx before React mounts. Reads the previously-applied
// theme out of localStorage and stamps the matching class on <html> so
// the very first paint (LoadingScreen) is in the user's palette. Falls
// through to the :root sky default when there's no persisted value.
export function applyPersistedTheme(): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_LS_KEY);
  } catch {
    // ignore — same fallback as above.
  }
  if (stored && isKnownThemeId(stored)) {
    document.documentElement.classList.add(`theme-${stored}`);
  }
}
