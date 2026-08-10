"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarX2, Check, ChevronDown, Loader2, Search, Trash2, X } from "lucide-react";

import { ApiError, deleteEngagement, listEngagements } from "@/lib/api";
import type { Engagement } from "@/lib/types";
import {
  CATEGORY_BADGE_CLASSES,
  CATEGORY_BLOCK_CLASSES,
  CATEGORY_LABELS,
  cn,
  formatDayLabel,
  formatDuration,
  formatTime,
  parseDateKey,
  parseNaiveIso,
  toDateKey,
} from "@/lib/utils";

const DELETE_CONFIRM_WINDOW_MS = 4000;

interface EngagementListProps {
  refreshSignal?: number;
  onChanged?: () => void;
  /** Called with a `yyyy-MM-dd` key when the user wants to jump the calendar to that engagement's date. */
  onSelectDate?: (dateKey: string) => void;
}

interface DayGroup {
  dateKey: string;
  label: string;
  engagements: Engagement[];
}

/** Splits engagements into date-grouped upcoming buckets (soonest first) and a separate already-ended list. */
function groupEngagements(engagements: Engagement[], now: Date): { upcoming: DayGroup[]; past: Engagement[] } {
  const past: Engagement[] = [];
  const byDate = new Map<string, Engagement[]>();

  for (const engagement of engagements) {
    if (parseNaiveIso(engagement.end_time) < now) {
      past.push(engagement);
      continue;
    }
    const key = toDateKey(parseNaiveIso(engagement.start_time));
    const bucket = byDate.get(key) ?? [];
    bucket.push(engagement);
    byDate.set(key, bucket);
  }

  const todayKey = toDateKey(now);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowKey = toDateKey(tomorrow);

  const upcoming = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, list]) => ({
      dateKey,
      label: dateKey === todayKey ? "Today" : dateKey === tomorrowKey ? "Tomorrow" : formatDayLabel(parseDateKey(dateKey)),
      engagements: list.sort((a, b) => a.start_time.localeCompare(b.start_time)),
    }));

  past.sort((a, b) => b.start_time.localeCompare(a.start_time));

  return { upcoming, past };
}

function formatStartsIn(start: Date, now: Date): string {
  const minutes = Math.round((start.getTime() - now.getTime()) / 60_000);
  if (minutes < 60) return `in ${Math.max(minutes, 0)}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `in ${hours}h` : `in ${hours}h ${remainder}m`;
}

export default function EngagementList({ refreshSignal, onChanged, onSelectDate }: EngagementListProps) {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => new Date());

  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
  }, []);

  // Keeps "happening now" / "starts in Xm" fresh without needing a refetch.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

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

  function handleDeleteClick(id: string) {
    if (confirmingId === id) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmingId(null);
      void handleDelete(id);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingId(id);
    confirmTimerRef.current = setTimeout(() => setConfirmingId(null), DELETE_CONFIRM_WINDOW_MS);
  }

  function cancelDeleteClick() {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingId(null);
  }

  const filtered = query.trim()
    ? engagements.filter((engagement) => engagement.title.toLowerCase().includes(query.trim().toLowerCase()))
    : engagements;
  const { upcoming, past } = groupEngagements(filtered, now);
  const isEmpty = upcoming.length === 0 && past.length === 0;

  function renderRow(engagement: Engagement, options: { showRelativeTime: boolean }) {
    const start = parseNaiveIso(engagement.start_time);
    const end = parseNaiveIso(engagement.end_time);
    const isHappeningNow = start <= now && now <= end;
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    const isConfirming = confirmingId === engagement.id;
    const isDeleting = deletingId === engagement.id;

    return (
      <div
        key={engagement.id}
        className={cn(
          "flex items-stretch gap-2.5 overflow-hidden rounded-xl border transition",
          isHappeningNow
            ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-500/5"
            : "border-zinc-200 dark:border-zinc-800",
        )}
      >
        <span className={cn("w-1 shrink-0 rounded-full my-2", CATEGORY_BLOCK_CLASSES[engagement.category])} />
        <button
          type="button"
          onClick={() => onSelectDate?.(toDateKey(start))}
          className="min-w-0 flex-1 py-2.5 pr-1 text-left"
          title="Jump to this date on the calendar"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50">
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
            {isHappeningNow && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                Now
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {formatTime(engagement.start_time)} – {formatTime(engagement.end_time)}
            <span className="text-zinc-400 dark:text-zinc-500"> · {formatDuration(durationMinutes)}</span>
            {options.showRelativeTime && !isHappeningNow && start > now && (
              <span className="text-zinc-400 dark:text-zinc-500"> · {formatStartsIn(start, now)}</span>
            )}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-1 pr-2">
          {isConfirming ? (
            <>
              <button
                type="button"
                onClick={() => handleDeleteClick(engagement.id)}
                disabled={isDeleting}
                aria-label={`Confirm delete ${engagement.title}`}
                className="rounded-lg p-1.5 text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={cancelDeleteClick}
                disabled={isDeleting}
                aria-label="Cancel delete"
                className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => handleDeleteClick(engagement.id)}
              aria-label={`Delete ${engagement.title}`}
              className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="shrink-0 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Engagements</h2>
      <p className="mt-1 shrink-0 text-sm text-zinc-500 dark:text-zinc-400">
        Everything currently on the calendar.
      </p>

      {engagements.length > 3 && (
        <div className="relative mt-3 shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search engagements…"
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-3 text-xs text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
        </div>
      )}

      {error && (
        <div className="mt-3 flex shrink-0 items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-zinc-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            <CalendarX2 className="h-6 w-6" />
            {query.trim() ? "No engagements match your search." : "Nothing scheduled yet. Try the Chat page to add something."}
          </div>
        ) : (
          <>
            {upcoming.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                <CalendarX2 className="h-6 w-6" />
                Nothing upcoming. Try the Chat page to add something.
              </div>
            )}
            {upcoming.map((group) => (
              <div key={group.dateKey}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  {group.label}
                </h3>
                <div className="space-y-2">
                  {group.engagements.map((engagement) => renderRow(engagement, { showRelativeTime: group.label === "Today" }))}
                </div>
              </div>
            ))}

            {past.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowPast((value) => !value)}
                  className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showPast && "rotate-180")} />
                  Past ({past.length})
                </button>
                {showPast && (
                  <div className="mt-1.5 space-y-2 opacity-70">
                    {past.map((engagement) => renderRow(engagement, { showRelativeTime: false }))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
