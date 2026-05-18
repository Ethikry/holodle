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
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${resp.status} ${resp.statusText}: ${text}`);
  }
  return (await resp.json()) as T;
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
