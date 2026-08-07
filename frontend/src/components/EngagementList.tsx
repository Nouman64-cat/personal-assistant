"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarX2, Loader2, Trash2 } from "lucide-react";

import { ApiError, deleteEngagement, listEngagements } from "@/lib/api";
import type { Engagement } from "@/lib/types";
import { CATEGORY_BADGE_CLASSES, CATEGORY_LABELS, cn, formatDateTime, formatTime } from "@/lib/utils";

interface EngagementListProps {
  refreshSignal?: number;
  onChanged?: () => void;
}

export default function EngagementList({ refreshSignal, onChanged }: EngagementListProps) {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Standard "reset, then fetch" effect pattern (see react.dev/learn/you-might-not-need-an-effect).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(null);
    listEngagements()
      .then((data) => {
        if (!cancelled) setEngagements(data);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : "Failed to load engagements.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteEngagement(id);
      setEngagements((previous) => previous.filter((engagement) => engagement.id !== id));
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to delete engagement.");
    } finally {
      setDeletingId(null);
    }
  }

  const sorted = [...engagements].sort((a, b) => a.start_time.localeCompare(b.start_time));

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Engagements</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Everything currently on the calendar.
      </p>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 max-h-96 space-y-2 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-zinc-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            <CalendarX2 className="h-6 w-6" />
            Nothing scheduled yet. Try Quick Parse above.
          </div>
        ) : (
          sorted.map((engagement) => (
            <div
              key={engagement.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {engagement.title}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      CATEGORY_BADGE_CLASSES[engagement.category],
                    )}
                  >
                    {CATEGORY_LABELS[engagement.category]}
                  </span>
                  {!engagement.is_blocking && (
                    <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                      Non-blocking
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {formatDateTime(engagement.start_time)} – {formatTime(engagement.end_time)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(engagement.id)}
                disabled={deletingId === engagement.id}
                aria-label={`Delete ${engagement.title}`}
                className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              >
                {deletingId === engagement.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
