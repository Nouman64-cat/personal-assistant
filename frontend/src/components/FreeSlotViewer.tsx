"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Loader2, RefreshCw } from "lucide-react";

import { ApiError, getFreeSlots, listEngagements } from "@/lib/api";
import type { Engagement, FreeSlotItem, ShiftSettings } from "@/lib/types";
import {
  CATEGORY_BLOCK_CLASSES,
  CATEGORY_LABELS,
  formatClockTime,
  formatDayLabel,
  formatDuration,
  formatTime,
  hourStringToMinutes,
  parseDateKey,
  parseNaiveIso,
  toDateKey,
  toUtcBoundary,
} from "@/lib/utils";

const MAX_RENDERED_DAYS = 31;

interface FreeSlotViewerProps {
  /** Bump this to force a refetch (e.g. after new engagements were added elsewhere). */
  refreshSignal?: number;
  /**
   * The saved shift, used to seed the initial day-start/day-end filters. The
   * parent should remount this component (e.g. via a `key` tied to the
   * shift's save version) when the shift changes, so this only needs to be
   * read once per mount rather than reactively synced.
   */
  initialShift: ShiftSettings;
}

function todayKey(): string {
  return toDateKey(new Date());
}

function addDaysKey(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function getDaysInRange(fromKey: string, toKey: string): Date[] {
  const start = parseDateKey(fromKey);
  const end = parseDateKey(toKey);
  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end && days.length < MAX_RENDERED_DAYS) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

interface BlockStyle {
  leftPct: number;
  widthPct: number;
}

function clipToWindow(
  start: Date,
  end: Date,
  windowStart: Date,
  windowEnd: Date,
): BlockStyle | null {
  if (end <= windowStart || start >= windowEnd) return null;
  const clippedStart = start < windowStart ? windowStart : start;
  const clippedEnd = end > windowEnd ? windowEnd : end;
  const totalMs = windowEnd.getTime() - windowStart.getTime();
  if (totalMs <= 0) return null;
  const leftPct = ((clippedStart.getTime() - windowStart.getTime()) / totalMs) * 100;
  const widthPct = ((clippedEnd.getTime() - clippedStart.getTime()) / totalMs) * 100;
  return { leftPct: Math.max(0, leftPct), widthPct: Math.max(0, widthPct) };
}

export default function FreeSlotViewer({ refreshSignal, initialShift }: FreeSlotViewerProps) {
  const [dateFrom, setDateFrom] = useState(todayKey());
  const [dateTo, setDateTo] = useState(addDaysKey(todayKey(), 2));
  const [dayStartHour, setDayStartHour] = useState(initialShift.day_start_hour.slice(0, 5));
  const [dayEndHour, setDayEndHour] = useState(initialShift.day_end_hour.slice(0, 5));
  const [minDurationMinutes, setMinDurationMinutes] = useState(30);

  const [freeSlots, setFreeSlots] = useState<FreeSlotItem[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // dayStartHour > dayEndHour is a valid overnight window (e.g. 18:00 to
  // 02:00, ending the next day) — only equal start/end is actually invalid.
  const isOvernight = dayStartHour > dayEndHour;
  const rangeIsValid = dateFrom <= dateTo && dayStartHour !== dayEndHour;

  // Plain (non-memoized) function, recreated each render so it always closes
  // over the latest filter values — used both by the "Apply" button and the
  // mount/refresh effect below.
  async function loadData() {
    if (!rangeIsValid) {
      setError(
        dateFrom > dateTo
          ? "Start date must be on or before the end date."
          : "Day start and day end must be different.",
      );
      return;
    }

    // The backend has no timezone concept — day_start_hour/day_end_hour and
    // date_from/date_to are taken literally as UTC. Convert the viewer's
    // local selections to their UTC equivalents before querying. `date_to`
    // always means "the last day a shift/window may *start*" (the backend
    // handles extending the tail of an overnight window past that date
    // itself), so both boundaries use dayStartHour for the date portion. The
    // end hour's time-of-day is anchored to the *next* local calendar day
    // when overnight, since that's the day it actually falls on.
    const startBoundary = toUtcBoundary(dateFrom, dayStartHour);
    const endHourAnchor = isOvernight ? addDaysKey(dateFrom, 1) : dateFrom;
    const endBoundaryRef = toUtcBoundary(endHourAnchor, dayEndHour);
    const dateToBoundary = toUtcBoundary(dateTo, dayStartHour);

    setIsLoading(true);
    setError(null);
    try {
      const [slotsResponse, engagementList] = await Promise.all([
        getFreeSlots({
          date_from: startBoundary.dateKey,
          date_to: dateToBoundary.dateKey,
          day_start_hour: startBoundary.time,
          day_end_hour: endBoundaryRef.time,
          min_duration_minutes: minDurationMinutes,
        }),
        listEngagements(),
      ]);
      setFreeSlots(slotsResponse.slots);
      setEngagements(engagementList);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Failed to load availability.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Fetches on mount and whenever the parent bumps `refreshSignal` (e.g.
    // after Quick Parse adds engagements), intentionally using whichever
    // filter values are current at that moment — not on every filter
    // keystroke, which goes through the explicit "Apply" button instead.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
    // loadData is intentionally omitted — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const days = useMemo(
    () => (rangeIsValid ? getDaysInRange(dateFrom, dateTo) : []),
    [dateFrom, dateTo, rangeIsValid],
  );

  const dayStartMinutes = hourStringToMinutes(dayStartHour);
  const dayEndMinutes = hourStringToMinutes(dayEndHour);

  const blockingEngagements = useMemo(
    () => engagements.filter((engagement) => engagement.is_blocking),
    [engagements],
  );

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Daily Timeline &amp; Free Slots
        </h2>
      </div>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Busy blocks in red/orange, open availability in green. Day start/end default to your{" "}
        <span className="font-medium">saved shift</span> — adjust below for a one-off search.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          loadData();
        }}
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:items-end"
      >
        <Field label="From">
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className={inputClasses}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            value={dateTo}
            min={dateFrom}
            onChange={(event) => setDateTo(event.target.value)}
            className={inputClasses}
          />
        </Field>
        <Field label="Day starts">
          <input
            type="time"
            value={dayStartHour}
            onChange={(event) => setDayStartHour(event.target.value)}
            className={inputClasses}
          />
        </Field>
        <Field label="Day ends">
          <input
            type="time"
            value={dayEndHour}
            onChange={(event) => setDayEndHour(event.target.value)}
            className={inputClasses}
          />
        </Field>
        <Field label="Min duration (min)">
          <input
            type="number"
            min={1}
            step={5}
            value={minDurationMinutes}
            onChange={(event) => setMinDurationMinutes(Number(event.target.value) || 1)}
            className={inputClasses}
          />
        </Field>
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Apply
        </button>
      </form>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        <LegendDot colorClass="bg-emerald-500" label="Free" />
        <LegendDot colorClass="bg-red-500" label="Meeting / Interview" />
        <LegendDot colorClass="bg-orange-500" label="Office Hours / Personal" />
      </div>

      <div className="mt-4 space-y-5">
        {days.length === 0 && !error && (
          <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Choose a valid date range to see availability.
          </p>
        )}

        {days.map((day) => (
          <DayRow
            key={toDateKey(day)}
            day={day}
            dayStartMinutes={dayStartMinutes}
            dayEndMinutes={dayEndMinutes}
            engagements={blockingEngagements}
            freeSlots={freeSlots}
          />
        ))}
      </div>
    </section>
  );
}

const inputClasses =
  "w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function LegendDot({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${colorClass}`} />
      {label}
    </span>
  );
}

interface DayRowProps {
  day: Date;
  dayStartMinutes: number;
  dayEndMinutes: number;
  engagements: Engagement[];
  freeSlots: FreeSlotItem[];
}

function DayRow({ day, dayStartMinutes, dayEndMinutes, engagements, freeSlots }: DayRowProps) {
  // dayStartMinutes > dayEndMinutes means this row's window is overnight
  // (e.g. 18:00 to 02:00) — the end falls on the *next* calendar day.
  const isOvernight = dayStartMinutes > dayEndMinutes;

  const windowStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
  windowStart.setMinutes(dayStartMinutes);
  const windowEnd = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + (isOvernight ? 1 : 0),
    0,
    0,
    0,
  );
  windowEnd.setMinutes(dayEndMinutes);

  const busyBlocks = engagements
    .map((engagement) => {
      const style = clipToWindow(
        parseNaiveIso(engagement.start_time),
        parseNaiveIso(engagement.end_time),
        windowStart,
        windowEnd,
      );
      return style ? { engagement, style } : null;
    })
    .filter((entry): entry is { engagement: Engagement; style: BlockStyle } => entry !== null);

  const freeBlocks = freeSlots
    .map((slot) => {
      const style = clipToWindow(
        parseNaiveIso(slot.start_time),
        parseNaiveIso(slot.end_time),
        windowStart,
        windowEnd,
      );
      return style ? { slot, style } : null;
    })
    .filter((entry): entry is { slot: FreeSlotItem; style: BlockStyle } => entry !== null);

  const hasContent = busyBlocks.length > 0 || freeBlocks.length > 0;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{formatDayLabel(day)}</span>
        <span className="text-zinc-400 dark:text-zinc-500">
          {formatClockTime(windowStart)} – {formatClockTime(windowEnd)}
          {isOvernight && " (+1 day)"}
        </span>
      </div>
      <div className="relative h-11 w-full overflow-hidden rounded-lg bg-zinc-100 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700">
        {!hasContent && (
          <span className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-400 dark:text-zinc-500">
            No engagements or availability in this window
          </span>
        )}
        {freeBlocks.map(({ slot, style }, index) => (
          <div
            key={`free-${index}`}
            title={`Free: ${formatTime(slot.start_time)} – ${formatTime(slot.end_time)} (${formatDuration(
              slot.duration_minutes,
            )})`}
            className="absolute inset-y-0 flex items-center overflow-hidden bg-emerald-500 px-1.5 text-[11px] font-medium text-white dark:bg-emerald-500/90"
            style={{ left: `${style.leftPct}%`, width: `${style.widthPct}%` }}
          >
            {style.widthPct > 8 && (
              <span className="truncate">{formatDuration(slot.duration_minutes)}</span>
            )}
          </div>
        ))}
        {busyBlocks.map(({ engagement, style }) => (
          <div
            key={engagement.id}
            title={`${engagement.title} — ${CATEGORY_LABELS[engagement.category]} (${formatTime(
              engagement.start_time,
            )} – ${formatTime(engagement.end_time)})`}
            className={`absolute inset-y-0 flex items-center overflow-hidden px-1.5 text-[11px] font-medium text-white ${CATEGORY_BLOCK_CLASSES[engagement.category]}`}
            style={{ left: `${style.leftPct}%`, width: `${style.widthPct}%` }}
          >
            {style.widthPct > 8 && <span className="truncate">{engagement.title}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
