"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarX2, Check, ChevronDown, Loader2, Moon, Plus, Sun } from "lucide-react";

import EngagementFormModal from "@/components/EngagementFormModal";
import { ApiError, listEngagements } from "@/lib/api";
import type { Engagement, ShiftSettings } from "@/lib/types";
import {
  CATEGORY_BADGE_CLASSES,
  CATEGORY_BLOCK_CLASSES,
  CATEGORY_LABELS,
  cn,
  formatClockTime,
  formatDayLabel,
  formatDuration,
  formatTime,
  hourStringToMinutes,
  minutesSinceMidnight,
  parseDateKey,
  parseNaiveIso,
  toDateKey,
} from "@/lib/utils";

interface ShiftEngagementListProps {
  shift: ShiftSettings;
  refreshSignal?: number;
  /** Called after an engagement is added, edited, or deleted, so siblings (e.g. the calendar view) can refetch. */
  onChanged?: () => void;
}

type ModalState = { mode: "create"; start: Date; end: Date } | { mode: "edit"; engagement: Engagement };

interface Interval {
  start: Date;
  end: Date;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start.getTime() <= last.end.getTime()) {
      if (interval.end.getTime() > last.end.getTime()) last.end = interval.end;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function clipInterval(start: Date, end: Date, windowStart: Date, windowEnd: Date): Interval | null {
  if (end <= windowStart || start >= windowEnd) return null;
  const clippedStart = start < windowStart ? windowStart : start;
  const clippedEnd = end > windowEnd ? windowEnd : end;
  return clippedEnd > clippedStart ? { start: clippedStart, end: clippedEnd } : null;
}

function intervalMinutes(interval: Interval): number {
  return Math.round((interval.end.getTime() - interval.start.getTime()) / 60_000);
}

/** A Date at `minutes` past midnight on the same local calendar day as `date`. */
function atMinutes(date: Date, minutes: number): Date {
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return new Date(midnight.getTime() + minutes * 60_000);
}

/**
 * The shift day a given instant belongs to, anchored at `day_start_hour`
 * rather than calendar midnight. A night shift running 10 PM to 6 AM is one
 * contiguous group under the date it *starts* on, instead of being split
 * across two calendar dates.
 */
function shiftDayKeyFor(date: Date, dayStartMinutes: number): string {
  if (minutesSinceMidnight(date) >= dayStartMinutes) return toDateKey(date);
  const previous = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
  return toDateKey(previous);
}

interface ShiftGroup {
  shiftKey: string;
  /** Instant the on-duty window opens. */
  shiftStart: Date;
  /** Instant the on-duty window closes (may fall on the next calendar day). */
  shiftEnd: Date;
  /** Instant the *next* shift day begins — always exactly 24h after `shiftStart`. */
  periodEnd: Date;
  isOvernight: boolean;
  engagements: Engagement[];
}

function buildShiftGroup(
  shiftKey: string,
  dayStartMinutes: number,
  dayEndMinutes: number,
  engagements: Engagement[],
): ShiftGroup {
  const isOvernight = dayStartMinutes > dayEndMinutes;
  const dayDate = parseDateKey(shiftKey);
  const shiftStart = atMinutes(dayDate, dayStartMinutes);
  const shiftEnd = isOvernight
    ? atMinutes(new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate() + 1), dayEndMinutes)
    : atMinutes(dayDate, dayEndMinutes);
  const periodEnd = new Date(shiftStart.getTime() + 24 * 60 * 60_000);
  return {
    shiftKey,
    shiftStart,
    shiftEnd,
    periodEnd,
    isOvernight,
    engagements: [...engagements].sort((a, b) => a.start_time.localeCompare(b.start_time)),
  };
}

/** Groups engagements by shift day, always including the current shift even when it has nothing scheduled. */
function buildShiftGroups(
  engagements: Engagement[],
  dayStartMinutes: number,
  dayEndMinutes: number,
  currentShiftKey: string,
): Map<string, ShiftGroup> {
  const byShift = new Map<string, Engagement[]>();
  for (const engagement of engagements) {
    const key = shiftDayKeyFor(parseNaiveIso(engagement.start_time), dayStartMinutes);
    const bucket = byShift.get(key) ?? [];
    bucket.push(engagement);
    byShift.set(key, bucket);
  }
  if (!byShift.has(currentShiftKey)) byShift.set(currentShiftKey, []);

  const groups = new Map<string, ShiftGroup>();
  for (const [shiftKey, list] of byShift) {
    groups.set(shiftKey, buildShiftGroup(shiftKey, dayStartMinutes, dayEndMinutes, list));
  }
  return groups;
}

function formatShiftLabel(group: ShiftGroup): string {
  const timeRange = `${formatClockTime(group.shiftStart)} – ${formatClockTime(group.shiftEnd)}`;
  if (!group.isOvernight) return `${formatDayLabel(group.shiftStart)} · ${timeRange}`;
  return `${formatDayLabel(group.shiftStart)} → ${formatDayLabel(group.shiftEnd)} · ${timeRange}`;
}

export default function ShiftEngagementList({ shift, refreshSignal, onChanged }: ShiftEngagementListProps) {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [modalState, setModalState] = useState<ModalState | null>(null);

  // Keeps "on shift now" / current-shift bucketing fresh without a refetch.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Plain (non-memoized) function, recreated each render — called on mount,
  // whenever the parent bumps `refreshSignal`, and again directly after this
  // component's own create/edit/delete so the list reflects the change
  // immediately rather than waiting on the parent's refresh to round-trip.
  async function loadEngagements() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listEngagements();
      setEngagements(data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to load engagements.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEngagements();
    // loadEngagements is intentionally omitted — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const dayStartMinutes = hourStringToMinutes(shift.day_start_hour.slice(0, 5));
  const dayEndMinutes = hourStringToMinutes(shift.day_end_hour.slice(0, 5));

  const currentShiftKey = useMemo(() => shiftDayKeyFor(now, dayStartMinutes), [now, dayStartMinutes]);

  const { upcoming, past } = useMemo(() => {
    const groups = buildShiftGroups(engagements, dayStartMinutes, dayEndMinutes, currentShiftKey);
    const all = [...groups.values()].sort((a, b) => a.shiftStart.getTime() - b.shiftStart.getTime());
    return {
      upcoming: all.filter((group) => group.periodEnd > now),
      past: all
        .filter((group) => group.periodEnd <= now)
        .sort((a, b) => b.shiftStart.getTime() - a.shiftStart.getTime()),
    };
  }, [engagements, dayStartMinutes, dayEndMinutes, currentShiftKey, now]);

  function renderShiftCard(group: ShiftGroup) {
    const isCurrent = group.shiftKey === currentShiftKey;
    const busyIntervals = mergeIntervals(
      group.engagements
        .filter((engagement) => engagement.is_blocking)
        .map((engagement) =>
          clipInterval(
            parseNaiveIso(engagement.start_time),
            parseNaiveIso(engagement.end_time),
            group.shiftStart,
            group.shiftEnd,
          ),
        )
        .filter((interval): interval is Interval => interval !== null),
    );
    const busyMinutes = busyIntervals.reduce((sum, interval) => sum + intervalMinutes(interval), 0);
    const shiftDurationMinutes = Math.max(
      0,
      Math.round((group.shiftEnd.getTime() - group.shiftStart.getTime()) / 60_000),
    );
    const utilizationPct =
      shiftDurationMinutes > 0 ? Math.min(100, Math.round((busyMinutes / shiftDurationMinutes) * 100)) : 0;
    const outsideCount = group.engagements.filter((engagement) => {
      const start = parseNaiveIso(engagement.start_time);
      const end = parseNaiveIso(engagement.end_time);
      return !(start < group.shiftEnd && end > group.shiftStart);
    }).length;

    return (
      <div
        key={group.shiftKey}
        className={cn(
          "rounded-xl border p-3",
          isCurrent
            ? "border-teal-300 bg-teal-50/50 dark:border-teal-800 dark:bg-teal-500/5"
            : "border-zinc-200 dark:border-zinc-800",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          {group.isOvernight ? (
            <Moon className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
          ) : (
            <Sun className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          )}
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{formatShiftLabel(group)}</span>
          {isCurrent && (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/15 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:text-teal-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-500" />
              On shift now
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs font-medium text-zinc-400 dark:text-zinc-500">
            {formatDuration(busyMinutes)} booked ({utilizationPct}%)
          </span>
          <button
            type="button"
            onClick={() =>
              setModalState({
                mode: "create",
                start: group.shiftStart,
                end: new Date(Math.min(group.shiftStart.getTime() + 60 * 60_000, group.shiftEnd.getTime())),
              })
            }
            title="Add an engagement to this shift"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs font-medium text-violet-600 transition hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-500/10"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={cn("h-full rounded-full", utilizationPct >= 90 ? "bg-amber-500" : "bg-teal-500")}
            style={{ width: `${utilizationPct}%` }}
          />
        </div>

        {outsideCount > 0 && (
          <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            {outsideCount} {outsideCount === 1 ? "engagement" : "engagements"} outside shift hours
          </p>
        )}

        {group.engagements.length === 0 ? (
          <p className="mt-2.5 flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
            <CalendarX2 className="h-3.5 w-3.5" />
            Nothing scheduled this shift.
          </p>
        ) : (
          <div className="mt-2.5 space-y-1.5">
            {group.engagements.map((engagement) => {
              const start = parseNaiveIso(engagement.start_time);
              const end = parseNaiveIso(engagement.end_time);
              const isOutside = !(start < group.shiftEnd && end > group.shiftStart);
              // Derived purely from the clock — no field to update, so this
              // flips to "Done" the instant end_time passes.
              const isDone = end < now;
              // Off-shift time can spill into the next calendar day within the
              // same 24h shift-day bucket — call out the date so a "5:00 PM"
              // row sorted after "9:00 PM" ones doesn't look out of order.
              const spillsToNextDay = toDateKey(start) !== toDateKey(group.shiftStart);
              return (
                <button
                  key={engagement.id}
                  type="button"
                  onClick={() => setModalState({ mode: "edit", engagement })}
                  title="Click to edit"
                  className="flex w-full items-center gap-2 rounded-lg border border-zinc-100 px-2 py-1.5 text-left transition hover:border-violet-200 hover:bg-violet-50/50 dark:border-zinc-800/70 dark:hover:border-violet-500/30 dark:hover:bg-violet-500/5"
                >
                  <span
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CATEGORY_BLOCK_CLASSES[engagement.category])}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                    {engagement.title}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      CATEGORY_BADGE_CLASSES[engagement.category],
                    )}
                  >
                    {CATEGORY_LABELS[engagement.category]}
                  </span>
                  {isOutside && (
                    <span className="shrink-0 rounded-full bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                      Off-shift
                    </span>
                  )}
                  {isDone && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                      <Check className="h-2.5 w-2.5" />
                      Done
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
                    {spillsToNextDay && `${formatDayLabel(start)} · `}
                    {formatTime(engagement.start_time)}–{formatTime(engagement.end_time)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Shifts</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {shift.day_start_hour.slice(0, 5)}–{shift.day_end_hour.slice(0, 5)} shift window
          </p>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      </div>

      {error && (
        <div className="mt-4 flex shrink-0 items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-zinc-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            {upcoming.map(renderShiftCard)}

            {past.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowPast((value) => !value)}
                  className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showPast && "rotate-180")} />
                  Past shifts ({past.length})
                </button>
                {showPast && <div className="mt-2 space-y-3 opacity-70">{past.map(renderShiftCard)}</div>}
              </div>
            )}
          </>
        )}
      </div>

      {modalState && (
        <EngagementFormModal
          mode={modalState.mode}
          initialStart={modalState.mode === "create" ? modalState.start : parseNaiveIso(modalState.engagement.start_time)}
          initialEnd={modalState.mode === "create" ? modalState.end : parseNaiveIso(modalState.engagement.end_time)}
          initialTitle={modalState.mode === "edit" ? modalState.engagement.title : undefined}
          initialDescription={modalState.mode === "edit" ? modalState.engagement.description : undefined}
          initialCategory={modalState.mode === "edit" ? modalState.engagement.category : undefined}
          initialIsBlocking={modalState.mode === "edit" ? modalState.engagement.is_blocking : undefined}
          engagementId={modalState.mode === "edit" ? modalState.engagement.id : undefined}
          onClose={() => setModalState(null)}
          onSaved={() => {
            setModalState(null);
            loadEngagements();
            onChanged?.();
          }}
        />
      )}
    </section>
  );
}
