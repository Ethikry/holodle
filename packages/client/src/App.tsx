import { useCallback, useEffect, useMemo } from "react";
import { MAX_GUESSES } from "@holodle/shared";
import { getDevSession, getDiscordSession, isEmbeddedInDiscord } from "./sdk/discord.js";
import {
  LOCAL_TZ,
  fetchDaily,
  fetchPrefs,
  fetchStats,
  fetchTalents,
  submitGuess,
} from "./net/api.js";
import { connectSocket } from "./net/socket.js";
import { useGame } from "./state/game.js";

import type { TalentSummary } from "@holodle/shared";
import { applyTheme } from "./themes.js";
import { Header } from "./components/Header.js";
import { StatusBanner } from "./components/StatusBanner.js";
import { StatsRow } from "./components/StatsRow.js";
import { ResultPanel } from "./components/ResultPanel.js";
import { GuessGrid } from "./components/GuessGrid.js";
import { TalentAutocomplete } from "./components/TalentAutocomplete.js";
import { PlayerBoardSidebar } from "./components/PlayerBoardSidebar.js";
import { HelpModal } from "./components/HelpModal.js";
import { LoadingScreen } from "./components/LoadingScreen.js";
import { RecapScreen } from "./components/RecapScreen.js";
import { WelcomeOverlay } from "./components/WelcomeOverlay.js";
import { NoticeOverlay } from "./components/NoticeOverlay.js";
import { Confetti } from "./components/Confetti.js";
import { CURRENT_NOTICE_VERSION } from "./notices.js";

function preloadAvatars(talents: TalentSummary[]): void {
  for (const t of talents) {
    if (!t.avatarUrl) continue;
    // Construct an Image whose `src` triggers a fetch; we don't need to
    // hold the reference — the browser caches by URL.
    const img = new Image();
    img.decoding = "async";
    img.src = t.avatarUrl;
  }
}

export function App(): JSX.Element {
  const {
    accessToken,
    instanceId,
    channelId,
    talents,
    history,
    status,
    error,
    loading,
    setSession,
    setTalents,
    setDaily,
    appendGuess,
    setStats,
    setPrefs,
    upsertPlayer,
    setSnapshot,
    updateProgress,
    removePlayer,
    setError,
    setLoading,
  } = useGame();

  // Bootstrap: load the public talent catalog first (no auth required), then
  // try to establish a Discord session. The catalog load is independent so a
  // failing OAuth handshake never blanks the autocomplete. Errors from each
  // step accumulate so a single visible banner doesn't hide upstream causes.
  useEffect(() => {
    let cancelled = false;
    let socketCleanup: (() => void) | null = null;

    void (async () => {
      setLoading(true);
      const errs: string[] = [];
      const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

      // 1. Public catalog (no auth).
      try {
        const talentList = await fetchTalents();
        if (!cancelled) {
          setTalents(talentList);
          // Warm the browser cache for every talent avatar while the rest of
          // bootstrap (OAuth + daily + stats + socket) is still in flight.
          // Without this, the first autocomplete keystroke triggers ~8 cold
          // ~12 KB fetches through the tunnel; preloading turns that into a
          // free cache hit. Fire-and-forget — no need to await.
          preloadAvatars(talentList);
        }
      } catch (err) {
        errs.push(`Could not load talents: ${describe(err)}`);
      }

      // 2. Session.
      const result = isEmbeddedInDiscord()
        ? await getDiscordSession()
        : ({ ok: true as const, session: getDevSession() });
      if (cancelled) return;
      if (!result.ok) {
        errs.push(result.reason);
        if (errs.length > 0) setError(errs.join("\n"));
        setLoading(false);
        return;
      }
      const session = result.session;
      setSession({
        accessToken: session.accessToken,
        instanceId: session.instanceId,
        channelId: session.channelId,
        selfUserId: session.user.id,
      });

      // 3. Per-user daily state + stats + prefs. Prefs is best-effort —
      //    a failure here defaults to the unmuted state in the store and
      //    doesn't block bootstrap.
      try {
        const [daily, stats, prefs] = await Promise.all([
          fetchDaily(session.accessToken),
          fetchStats(session.accessToken),
          fetchPrefs(session.accessToken).catch(() => null),
        ]);
        if (cancelled) return;
        setDaily(daily);
        setStats(stats);
        // Returning users who've already finished today's puzzle land
        // directly on the recap overlay instead of an empty grid. Only
        // fires when the bootstrap finds a terminal status — fresh
        // launches with status="playing" still see the normal board.
        if (daily.status !== "playing") {
          useGame.getState().setRecapOpen(true);
        }
        if (prefs) {
          setPrefs(prefs);
          // Apply the persisted theme as soon as it's known so the
          // palette doesn't flash from the default to the user's pick.
          applyTheme(prefs.theme);
          // First-launch welcome vs. one-time notice, in that priority.
          // A brand-new user (never welcomed) only ever sees the welcome;
          // dismissing it catches them up to CURRENT_NOTICE_VERSION so
          // historical notices never retroactively pop. A returning user
          // whose stored notice version is behind the current one sees the
          // notice once. Both flags are server-tracked because Discord
          // Activity iframes partition localStorage across launches.
          if (!prefs.welcomed) {
            useGame.getState().setWelcomeOpen(true);
          } else if (prefs.lastSeenNoticeVersion < CURRENT_NOTICE_VERSION) {
            useGame.getState().setNoticeOpen(true);
          }
        }
      } catch (err) {
        errs.push(describe(err));
      }

      // 4. Socket presence — pass channelId + tz so the server can route
      // the exit embed and compute the right user-local dayIndex.
      const socket = connectSocket(
        session.accessToken,
        session.instanceId,
        session.channelId,
        LOCAL_TZ,
        {
          onSnapshot: setSnapshot,
          onJoin: upsertPlayer,
          onProgress: updateProgress,
          onLeave: ({ userId }) => removePlayer(userId),
        },
      );
      socketCleanup = () => socket.disconnect();

      if (!cancelled) {
        if (errs.length > 0) setError(errs.join("\n"));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      socketCleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGuess = useCallback(
    async (talentId: string) => {
      if (!accessToken || !instanceId) {
        setError("Not signed in to Discord yet — guesses are disabled until the session is established.");
        return;
      }
      try {
        const resp = await submitGuess(accessToken, talentId, instanceId, channelId);
        appendGuess(resp.diff, resp.status, resp.answer);
        if (resp.status !== "playing") {
          // Refresh stats on settle.
          const stats = await fetchStats(accessToken);
          setStats(stats);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [accessToken, instanceId, channelId, appendGuess, setStats, setError],
  );

  const inputDisabled = useMemo(
    () =>
      !accessToken ||
      status !== "playing" ||
      history.length >= MAX_GUESSES ||
      talents.length === 0 ||
      loading,
    [accessToken, status, history.length, talents.length, loading],
  );

  const emptyCatalog = !loading && talents.length === 0;

  // While the bootstrap effect is still running, show the LoadingScreen
  // instead of a half-populated UI. We hold the loading state until talents,
  // session, daily, and stats have all resolved (or errored). An error that
  // flips loading=false will fall through to the normal layout below, which
  // surfaces the red error banner.
  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <div className="flex min-h-full">
      <PlayerBoardSidebar />
      <main className="mx-auto flex min-h-full max-w-4xl flex-1 flex-col gap-1 sm:gap-2">
        <Header />
        <StatusBanner />
        <StatsRow />
        <ResultPanel />
        <GuessGrid />
        {emptyCatalog ? (
          <div className="mx-4 my-6 rounded-[1.5rem] border border-dashed border-holo-muted/40 p-6 text-center text-sm text-holo-muted">
            No talents loaded yet. Edit <code>talent_data.json</code> at the repo root to add some.
          </div>
        ) : (
          <TalentAutocomplete onSubmit={handleGuess} disabled={inputDisabled} />
        )}
        {error && (
          <div className="mx-4 my-4 whitespace-pre-line rounded-xl border border-holo-bad/40 bg-holo-badBg/40 p-3 text-sm text-holo-bad">
            {error}
          </div>
        )}
        <footer className="mt-auto py-6 text-center text-xs text-holo-muted">
          holodle — fan-made game. not affiliated with Cover Corp.
        </footer>
        <HelpModal />
      </main>
      <RecapScreen />
      <Confetti />
      <WelcomeOverlay />
      <NoticeOverlay />
    </div>
  );
}
