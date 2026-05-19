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

export async function fetchTalents(): Promise<TalentSummary[]> {
  return ok<TalentSummary[]>(await fetch("/api/talents"));
}

export async function fetchDaily(accessToken: string): Promise<DailyState> {
  return ok<DailyState>(await fetch("/api/daily", { headers: authHeaders(accessToken) }));
}

export async function submitGuess(
  accessToken: string,
  talentId: string,
  instanceId: string,
): Promise<GuessResponse> {
  return ok<GuessResponse>(
    await fetch("/api/guess", {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ talentId, instanceId }),
    }),
  );
}

export async function fetchStats(accessToken: string): Promise<UserStats> {
  return ok<UserStats>(await fetch("/api/stats", { headers: authHeaders(accessToken) }));
}
