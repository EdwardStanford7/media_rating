import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { QueuedEntryRow } from "@/components/QueuedEntryRow";
import type { QueuedEntry } from "@/lib/types";

export function QueuePanel({
    activeSessionId,
    busy,
    queueRankMode,
    queuedEntries,
    onDelete,
    onPickImage,
    onRename,
    onStart,
    onStartQueue,
    onStopQueue
}: {
    activeSessionId: string | null;
    busy: boolean;
    queueRankMode: boolean;
    queuedEntries: QueuedEntry[];
    onDelete: (entry: QueuedEntry) => Promise<void>;
    onPickImage: (entry: QueuedEntry) => void;
    onRename: (entry: QueuedEntry, name: string) => Promise<void>;
    onStart: (entry: QueuedEntry) => Promise<void>;
    onStartQueue: () => Promise<void>;
    onStopQueue: () => void;
}) {
    const [currentTime, setCurrentTime] = useState(Date.now());

    useEffect(() => {
        const interval = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
        return () => window.clearInterval(interval);
    }, []);

    const readyEntries = queuedEntries.filter((entry) => entry.availableAt <= currentTime);
    const pendingEntries = queuedEntries.filter((entry) => entry.availableAt > currentTime);

    return (
        <section className="stack panel queue-panel">
            <div className="toolbar queue-toolbar">
                <strong>Queue</strong>
                <div className="queue-summary">
                    <span className="metric">{queuedEntries.length} queued</span>
                    <span className="metric">{readyEntries.length} ready</span>
                </div>
            </div>
            <div className="queue-rank-actions">
                <button
                    className={queueRankMode ? undefined : "primary"}
                    disabled={queueRankMode ? false : busy || Boolean(activeSessionId) || readyEntries.length === 0}
                    type="button"
                    onClick={() => {
                        if (queueRankMode) {
                            onStopQueue();
                        } else {
                            void onStartQueue();
                        }
                    }}
                >
                    <Icon name={queueRankMode ? "cancel" : "rank"} />
                    <span>{queueRankMode ? "Stop Ranking Queue" : "Rank Queue"}</span>
                </button>
            </div>

            {queuedEntries.length > 0 ? (
                <div className="queue-list">
                    {readyEntries.map((entry) => (
                        <QueuedEntryRow
                            disabled={busy || Boolean(activeSessionId)}
                            entry={entry}
                            isReady
                            key={entry.id}
                            onDelete={onDelete}
                            onPickImage={onPickImage}
                            onRename={onRename}
                            onStart={onStart}
                        />
                    ))}
                    {pendingEntries.map((entry) => (
                        <QueuedEntryRow
                            disabled={busy || Boolean(activeSessionId)}
                            entry={entry}
                            isReady={false}
                            key={entry.id}
                            onDelete={onDelete}
                            onPickImage={onPickImage}
                            onRename={onRename}
                            onStart={onStart}
                        />
                    ))}
                </div>
            ) : (
                <EmptyState compact icon="rank" title="Queue Empty">
                    {activeSessionId
                        ? "Queue controls will return after the active ranking finishes."
                        : "Queued entries will appear here after you add them."}
                </EmptyState>
            )}
        </section>
    );
}
