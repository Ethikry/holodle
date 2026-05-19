import { useCallback, useEffect, useMemo } from "react";
import { MAX_GUESSES } from "@holodle/shared";
import { getDevSession, getDiscordSession, isEmbeddedInDiscord } from "./sdk/discord.js";
import { fetchDaily, fetchStats, fetchTalents, submitGuess } from "./net/api.js";
import { connectSocket } from "./net/socket.js";
import { useGame } from "./state/game.js";

import { Header } from "./components/Header.js";
import { StatusBanner } from "./components/StatusBanner.js";
import { StatsRow } from "./components/StatsRow.js";
import { ResultPanel } from "./components/ResultPanel.js";
import { GuessGrid } from "./components/GuessGrid.js";
import { TalentAutocomplete } from "./components/TalentAutocomplete.js";
import { PlayerList } from "./components/PlayerList.js";
import { HelpModal } from "./components/HelpModal.js";

export function App(): JSX.Element {
  const {
    accessToken,
    instanceId,
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
        if (!cancelled) setTalents(talentList);
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
        selfUserId: session.user.id,
      });

      // 3. Per-user daily state + stats.
      try {
        const [daily, stats] = await Promise.all([
          fetchDaily(session.accessToken),
          fetchStats(session.accessToken),
        ]);
        if (cancelled) return;
        setDaily(daily);
        setStats(stats);
      } catch (err) {
        errs.push(describe(err));
      }

      // 4. Socket presence.
      const socket = connectSocket(session.accessToken, session.instanceId, {
        onSnapshot: setSnapshot,
        onJoin: upsertPlayer,
        onProgress: updateProgress,
        onLeave: ({ userId }) => removePlayer(userId),
      });
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
        const resp = await submitGuess(accessToken, talentId, instanceId);
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
    [accessToken, instanceId, appendGuess, setStats, setError],
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

  return (
    <main className="mx-auto flex min-h-full max-w-3xl flex-col">
      <Header />
      <StatusBanner />
      <StatsRow />
      <ResultPanel />
      {emptyCatalog ? (
        <div className="mx-4 my-6 rounded-2xl border border-dashed border-holo-muted/40 p-6 text-center text-sm text-holo-muted">
          No talents loaded yet. Edit <code>talent_data.json</code> at the repo root to add some.
        </div>
      ) : (
        <TalentAutocomplete onSubmit={handleGuess} disabled={inputDisabled} />
      )}
      <GuessGrid />
      <PlayerList />
      {error && (
        <div className="mx-4 my-4 whitespace-pre-line rounded-xl border border-holo-bad/40 bg-holo-badBg/40 p-3 text-sm text-holo-bad">
          {error}
        </div>
      )}
      <footer className="mt-auto py-6 text-center text-xs text-holo-muted">
        Holodle — Fan-made game. Not affiliated with Cover Corp.
      </footer>
      <HelpModal />
    </main>
  );
}
