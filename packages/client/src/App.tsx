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

  // Bootstrap: get Discord session (or dev session if not embedded), then
  // load talents + daily state + stats in parallel, then connect socket.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const session = isEmbeddedInDiscord() ? await getDiscordSession() : getDevSession();
        if (!session) {
          setError("Could not initialize Discord session. Open this app inside a Discord activity.");
          setLoading(false);
          return;
        }
        if (cancelled) return;
        setSession({
          accessToken: session.accessToken,
          instanceId: session.instanceId,
          selfUserId: session.user.id,
        });

        const [talentList, daily, stats] = await Promise.all([
          fetchTalents(),
          fetchDaily(session.accessToken),
          fetchStats(session.accessToken),
        ]);
        if (cancelled) return;
        setTalents(talentList);
        setDaily(daily);
        setStats(stats);

        const socket = connectSocket(session.accessToken, session.instanceId, {
          onSnapshot: setSnapshot,
          onJoin: upsertPlayer,
          onProgress: updateProgress,
          onLeave: ({ userId }) => removePlayer(userId),
        });
        return () => {
          socket.disconnect();
        };
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGuess = useCallback(
    async (talentId: string) => {
      if (!accessToken || !instanceId) return;
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
    () => status !== "playing" || history.length >= MAX_GUESSES || talents.length === 0 || loading,
    [status, history.length, talents.length, loading],
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
        <div className="mx-4 my-4 rounded-xl border border-holo-bad/40 bg-holo-badBg/40 p-3 text-sm text-holo-bad">
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
