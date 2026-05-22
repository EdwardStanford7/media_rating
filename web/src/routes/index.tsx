import { createFileRoute, useRouter } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  createCategory,
  createEntryWithBinaryRanking,
  deleteEntry,
  getBinarySession,
  getFreeRankMatchup,
  getSession,
  importLegacyEntries,
  loadDashboard,
  renameEntry,
  startRerankEntry,
  submitBinaryWinner,
  submitFreeRankWinner,
  switchEntryCategory
} from "@/lib/server/actions";
import { signIn, signOut, signUp } from "@/lib/auth-client";
import { orderEntries } from "@/lib/ranking";
import { parseLegacyWorkbook, writeExportWorkbook } from "@/lib/importExport";
import type {
  BinarySessionView,
  CategoryWithEntries,
  DashboardData,
  DisplayMode,
  Entry,
  FreeRankMatchup
} from "@/lib/types";

export const Route = createFileRoute("/")({
  loader: async () => {
    const session = await getSession();
    if (!session?.user) {
      return { session: null, dashboard: null };
    }

    return {
      session,
      dashboard: await loadDashboard({ data: { displayMode: "binary" } })
    };
  },
  component: Home
});

function Home() {
  const { session, dashboard } = Route.useLoaderData();

  if (!session?.user || !dashboard) {
    return <AuthPage />;
  }

  return <Dashboard initialDashboard={dashboard} userName={session.user.name} />;
}

function AuthPage() {
  const [error, setError] = useState<string | null>(null);

  async function handleEmailAuth(event: FormEvent<HTMLFormElement>, mode: "signin" | "signup") {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? email);

    try {
      if (mode === "signup") {
        await signUp.email({ email, password, name, callbackURL: "/" });
      } else {
        await signIn.email({ email, password, callbackURL: "/" });
      }
      window.location.assign("/");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed");
    }
  }

  async function handleSocial(provider: "google" | "apple") {
    setError(null);
    try {
      await signIn.social({ provider, callbackURL: "/" });
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed");
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="stack">
          <div>
            <h1>Media Rating</h1>
            <p className="muted">Private ranked collections for books, movies, shows, and games.</p>
          </div>
          <button className="primary" type="button" onClick={() => handleSocial("google")}>
            Continue with Google
          </button>
          <button type="button" onClick={() => handleSocial("apple")}>
            Continue with Apple
          </button>
          {error ? <div className="status">{error}</div> : null}
        </div>

        <div className="stack">
          <form className="stack" onSubmit={(event) => handleEmailAuth(event, "signin")}>
            <h2>Sign In</h2>
            <input name="email" type="email" placeholder="Email" autoComplete="email" required />
            <input
              name="password"
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              required
            />
            <button className="primary" type="submit">Sign In</button>
          </form>

          <form className="stack" onSubmit={(event) => handleEmailAuth(event, "signup")}>
            <h2>Create Account</h2>
            <input name="name" placeholder="Name" autoComplete="name" required />
            <input name="email" type="email" placeholder="Email" autoComplete="email" required />
            <input
              name="password"
              type="password"
              placeholder="Password"
              autoComplete="new-password"
              required
            />
            <button type="submit">Create Account</button>
          </form>
        </div>
      </section>
    </main>
  );
}

function Dashboard({
  initialDashboard,
  userName
}: {
  initialDashboard: DashboardData;
  userName: string;
}) {
  const router = useRouter();
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    initialDashboard.categories[0]?.id ?? ""
  );
  const [displayMode, setDisplayMode] = useState<DisplayMode>("binary");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedCategory = useMemo(
    () =>
      dashboard.categories.find((category) => category.id === selectedCategoryId) ??
      dashboard.categories[0] ??
      null,
    [dashboard.categories, selectedCategoryId]
  );
  const displayedEntries = selectedCategory
    ? orderEntries(selectedCategory.entries, displayMode)
    : [];

  async function refresh() {
    const nextDashboard = await loadDashboard({ data: { displayMode: "binary" } });
    setDashboard(nextDashboard);
    await router.invalidate();
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);

    try {
      await createCategory({ data: { name: String(form.get("name") ?? "") } });
      event.currentTarget.reset();
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCategory) {
      return;
    }

    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const firstConsumedAt = dateInputToTimestamp(String(form.get("firstConsumedAt") ?? ""));

    try {
      const result = await createEntryWithBinaryRanking({
        data: {
          categoryId: selectedCategory.id,
          name: String(form.get("name") ?? ""),
          firstConsumedAt
        }
      });
      event.currentTarget.reset();

      if (result.kind === "session") {
        setActiveSessionId(result.sessionId);
      }

      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRerank(entryId: string) {
    setBusy(true);
    setMessage(null);

    try {
      const result = await startRerankEntry({ data: { entryId } });
      if (result.kind === "session") {
        setActiveSessionId(result.sessionId);
      }
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(entryId: string, name: string) {
    setBusy(true);
    setMessage(null);

    try {
      await renameEntry({ data: { entryId, name } });
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(entryId: string) {
    setBusy(true);
    setMessage(null);

    try {
      await deleteEntry({ data: { entryId } });
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitch(entryId: string, targetCategoryId: string) {
    setBusy(true);
    setMessage(null);

    try {
      const result = await switchEntryCategory({ data: { entryId, targetCategoryId } });
      if (result.kind === "session") {
        setActiveSessionId(result.sessionId);
      }
      setSelectedCategoryId(targetCategoryId);
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const file = form.get("workbook");

    if (!(file instanceof File) || file.size === 0) {
      setBusy(false);
      return;
    }

    try {
      const firstConsumedAt = dateInputToTimestamp(String(form.get("firstConsumedAt") ?? ""));
      const parsed = await parseLegacyWorkbook(await file.arrayBuffer(), firstConsumedAt);
      const result = await importLegacyEntries({ data: parsed });
      setMessage(`Imported ${result.importedCount} entries.`);
      event.currentTarget.reset();
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    const buffer = await writeExportWorkbook(dashboard.categories);
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Media Ratings.xlsx";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="topbar">
          <strong>Media Rating</strong>
          <button type="button" onClick={() => signOut().then(() => window.location.assign("/"))}>
            Sign Out
          </button>
        </div>
        <p className="muted">{userName}</p>

        <form className="form-row" onSubmit={handleCreateCategory}>
          <input name="name" placeholder="New category" required />
          <button disabled={busy} type="submit">Add</button>
        </form>

        <div className="category-list">
          {dashboard.categories.map((category) => (
            <button
              className={`category-button ${category.id === selectedCategory?.id ? "active" : ""}`}
              key={category.id}
              type="button"
              onClick={() => setSelectedCategoryId(category.id)}
            >
              <strong>{category.name}</strong>
              <span className="muted"> · {category.entries.length}</span>
            </button>
          ))}
        </div>

        <form className="stack panel" onSubmit={handleImport}>
          <strong>Import xlsx</strong>
          <input name="firstConsumedAt" type="date" />
          <input name="workbook" type="file" accept=".xlsx" />
          <button disabled={busy} type="submit">Import</button>
        </form>
      </aside>

      <section className="main stack">
        <div className="topbar">
          <div>
            <h1>{selectedCategory?.name ?? "Categories"}</h1>
            <p className="muted">Binary rank is primary. Free-rank Elo is saved separately.</p>
          </div>
          <div className="row">
            <select value={displayMode} onChange={(event) => setDisplayMode(event.target.value as DisplayMode)}>
              <option value="binary">Binary</option>
              <option value="combined">Combined</option>
              <option value="free_rank">Free Rank</option>
            </select>
            <button type="button" onClick={handleExport}>Export</button>
          </div>
        </div>

        {message ? <div className="status">{message}</div> : null}

        {selectedCategory ? (
          <form className="panel form-row" onSubmit={handleCreateEntry}>
            <input name="name" placeholder="New entry" required />
            <input name="firstConsumedAt" type="date" />
            <button className="primary" disabled={busy} type="submit">Add + Rank</button>
          </form>
        ) : null}

        {activeSessionId ? (
          <BinaryRankPanel
            sessionId={activeSessionId}
            onComplete={async () => {
              setActiveSessionId(null);
              await refresh();
            }}
          />
        ) : null}

        <FreeRankPanel categories={dashboard.categories} onRanked={refresh} />

        <section className="entries-grid">
          {displayedEntries.map((entry, index) => (
            <EntryCard
              displayIndex={index}
              entry={entry}
              categories={dashboard.categories}
              key={entry.id}
              selectedCategoryId={selectedCategory.id}
              onDelete={() => handleDelete(entry.id)}
              onRename={(name) => handleRename(entry.id, name)}
              onRerank={() => handleRerank(entry.id)}
              onSwitch={(targetCategoryId) => handleSwitch(entry.id, targetCategoryId)}
            />
          ))}
        </section>
      </section>
    </main>
  );
}

function EntryCard({
  entry,
  displayIndex,
  categories,
  selectedCategoryId,
  onDelete,
  onRename,
  onRerank,
  onSwitch
}: {
  entry: Entry;
  displayIndex: number;
  categories: CategoryWithEntries[];
  selectedCategoryId: string;
  onDelete: () => void;
  onRename: (name: string) => void;
  onRerank: () => void;
  onSwitch: (targetCategoryId: string) => void;
}) {
  const [renameValue, setRenameValue] = useState(entry.name);
  const [targetCategoryId, setTargetCategoryId] = useState(selectedCategoryId);

  useEffect(() => {
    setRenameValue(entry.name);
    setTargetCategoryId(selectedCategoryId);
  }, [entry.name, selectedCategoryId]);

  return (
    <article className="entry-card">
      <EntryPoster entry={entry} />
      <div className="entry-card-body">
        <strong>#{displayIndex + 1} {entry.name}</strong>
        <div className="metric-row">
          <span className="metric">Binary {entry.rankPosition + 1}</span>
          <span className="metric">Elo {Math.round(entry.freeRankElo)}</span>
          <span className="metric">{entry.freeRankWins}-{entry.freeRankLosses}</span>
          {entry.firstConsumedAt ? (
            <span className="metric">{formatDate(entry.firstConsumedAt)}</span>
          ) : null}
        </div>
        <button type="button" onClick={onRerank}>Rerank</button>
        <div className="entry-actions">
          <input
            aria-label={`Rename ${entry.name}`}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
          />
          <button type="button" onClick={() => onRename(renameValue)}>Rename</button>
        </div>
        <div className="entry-actions">
          <select
            aria-label={`Move ${entry.name}`}
            value={targetCategoryId}
            onChange={(event) => setTargetCategoryId(event.target.value)}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button
            disabled={targetCategoryId === selectedCategoryId}
            type="button"
            onClick={() => onSwitch(targetCategoryId)}
          >
            Move
          </button>
        </div>
        <button className="danger" type="button" onClick={onDelete}>Delete</button>
      </div>
    </article>
  );
}

function EntryPoster({ entry }: { entry: Entry }) {
  if (entry.imageKey) {
    return (
      <img
        className="entry-poster"
        src={`/api/images/${entry.id}`}
        alt=""
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
      />
    );
  }

  return <div className="entry-poster">{entry.name}</div>;
}

function BinaryRankPanel({
  sessionId,
  onComplete
}: {
  sessionId: string;
  onComplete: () => Promise<void>;
}) {
  const [session, setSession] = useState<BinarySessionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBinarySession({ data: { sessionId } })
      .then(setSession)
      .catch((loadError) => setError(errorMessage(loadError)));
  }, [sessionId]);

  async function chooseWinner(winnerId: string) {
    setError(null);
    try {
      const result = await submitBinaryWinner({ data: { sessionId, winnerId } });
      if (result.kind === "completed") {
        await onComplete();
        return;
      }

      setSession(await getBinarySession({ data: { sessionId } }));
    } catch (submitError) {
      setError(errorMessage(submitError));
    }
  }

  if (error) {
    return <div className="status">{error}</div>;
  }

  if (!session) {
    return <section className="rank-panel">Loading ranking...</section>;
  }

  return (
    <section className="rank-panel stack">
      <div className="toolbar">
        <strong>Binary Rank · {session.categoryName}</strong>
        <span className="muted">
          Range {session.lowerBound + 1}-{session.upperBound + 1} · {session.comparisonCount} matches
        </span>
      </div>
      <div className="match-grid">
        <button className="match-choice" type="button" onClick={() => chooseWinner(session.subject.id)}>
          <MatchPoster entry={session.subject} />
          <strong>{session.subject.name}</strong>
        </button>
        <button className="match-choice" type="button" onClick={() => chooseWinner(session.opponent.id)}>
          <MatchPoster entry={session.opponent} />
          <strong>{session.opponent.name}</strong>
        </button>
      </div>
    </section>
  );
}

function FreeRankPanel({
  categories,
  onRanked
}: {
  categories: CategoryWithEntries[];
  onRanked: () => Promise<void>;
}) {
  const [categorySelection, setCategorySelection] = useState<string | "any">("any");
  const [matchup, setMatchup] = useState<FreeRankMatchup | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMatchup() {
    setError(null);
    try {
      setMatchup(await getFreeRankMatchup({ data: { categorySelection } }));
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }

  async function chooseWinner(winnerId: string) {
    if (!matchup) {
      return;
    }

    setError(null);
    try {
      await submitFreeRankWinner({
        data: {
          categoryId: matchup.categoryId,
          entryAId: matchup.entryA.id,
          entryBId: matchup.entryB.id,
          winnerId
        }
      });
      await onRanked();
      await loadMatchup();
    } catch (submitError) {
      setError(errorMessage(submitError));
    }
  }

  return (
    <section className="rank-panel stack">
      <div className="toolbar">
        <strong>Free Rank</strong>
        <div className="row">
          <select value={categorySelection} onChange={(event) => setCategorySelection(event.target.value)}>
            <option value="any">Any</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={loadMatchup}>Next</button>
        </div>
      </div>

      {error ? <div className="status">{error}</div> : null}

      {matchup ? (
        <>
          <span className="muted">{matchup.categoryName}</span>
          <div className="match-grid">
            <button className="match-choice" type="button" onClick={() => chooseWinner(matchup.entryA.id)}>
              <MatchPoster entry={matchup.entryA} />
              <strong>{matchup.entryA.name}</strong>
            </button>
            <button className="match-choice" type="button" onClick={() => chooseWinner(matchup.entryB.id)}>
              <MatchPoster entry={matchup.entryB} />
              <strong>{matchup.entryB.name}</strong>
            </button>
          </div>
        </>
      ) : (
        <div className="muted">No active matchup selected.</div>
      )}
    </section>
  );
}

function MatchPoster({ entry }: { entry: Entry }) {
  if (entry.imageKey) {
    return <img className="match-poster" src={`/api/images/${entry.id}`} alt="" />;
  }

  return <div className="match-poster">{entry.name}</div>;
}

function dateInputToTimestamp(value: string) {
  return value ? new Date(`${value}T00:00:00`).getTime() : null;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(timestamp));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
