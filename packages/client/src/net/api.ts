import type {
  DailyState,
  GuessResponse,
  TalentSummary,
  UserStats,
} from "@holodle/shared";

function authHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

async function ok<T>(resp: Response): Promise<T> {
  const url = new URL(resp.url, window.location.href).pathname;
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    // Even on non-2xx, an HTML body usually means the request never reached
    // the Fastify backend at all (Vite proxy 502, cloudflared 521, etc.).
    if (text.trimStart().startsWith("<")) {
      throw new Error(
        `${url} returned an HTML error page (status ${resp.status}). Is the Fastify server on :3001 running?`,
      );
    }
    throw new Error(`${resp.status} ${resp.statusText} from ${url}: ${text}`);
  }
  const text = await resp.text();
  // 2xx with HTML body: Vite proxy upstream failure, or stale tunnel URL still
  // serving cloudflared's error page with a 200. Either way, name the cause.
  if (text.trimStart().startsWith("<")) {
    throw new Error(
      `${url} returned HTML instead of JSON. Is the Fastify server on :3001 running?`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(
      `Invalid JSON from ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Resolved at module-load; the user's locale is determined by the system at
// page load, so a stable value for the session is fine.
export const LOCAL_TZ: string =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export async function fetchTalents(): Promise<TalentSummary[]> {
  return ok<TalentSummary[]>(await fetch("/api/talents"));
}

export async function fetchDaily(accessToken: string): Promise<DailyState> {
  const url = `/api/daily?tz=${encodeURIComponent(LOCAL_TZ)}`;
  return ok<DailyState>(await fetch(url, { headers: authHeaders(accessToken) }));
}

export async function submitGuess(
  accessToken: string,
  talentId: string,
  instanceId: string,
  channelId: string | null,
): Promise<GuessResponse> {
  return ok<GuessResponse>(
    await fetch("/api/guess", {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ talentId, instanceId, channelId, tz: LOCAL_TZ }),
    }),
  );
}

export async function fetchStats(accessToken: string): Promise<UserStats> {
  return ok<UserStats>(await fetch("/api/stats", { headers: authHeaders(accessToken) }));
}

// Per-user preferences. The shape here mirrors `UserPrefs` on the server
// (packages/server/src/db/client.ts) — keep them in sync when adding
// fields.
export interface UserPrefs {
  recapPingMuted: boolean;
  theme: string;
  // Server-tracked first-launch welcome flag. Server-side because
  // Discord Activity iframes don't reliably share localStorage across
  // launches (partitioned storage).
  welcomed: boolean;
  // Highest one-time "patch notes" notice version this user has dismissed.
  // Compared against CURRENT_NOTICE_VERSION (src/notices.tsx) to decide
  // whether to surface the notice overlay. 0 = seen nothing.
  lastSeenNoticeVersion: number;
}

export async function fetchPrefs(accessToken: string): Promise<UserPrefs> {
  return ok<UserPrefs>(await fetch("/api/prefs", { headers: authHeaders(accessToken) }));
}

// PATCH is a partial update — the client may send only the field it
// changed. The server merges with the existing row.
export async function patchPrefs(
  accessToken: string,
  patch: Partial<UserPrefs>,
): Promise<UserPrefs> {
  return ok<UserPrefs>(
    await fetch("/api/prefs", {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify(patch),
    }),
  );
}
