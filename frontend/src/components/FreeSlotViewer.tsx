"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarClock, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { ApiError, getFreeSlots, listEngagements } from "@/lib/api";
import type { Engagement, EngagementCategory, FreeSlotItem, ShiftSettings } from "@/lib/types";
import {
  CATEGORY_BLOCK_CLASSES,
  CATEGORY_LABELS,
  cn,
  formatClockTime,
  formatDayLabel,
  formatDuration,
  formatMonthLabel,
  formatTime,
  hourStringToMinutes,
  minutesSinceMidnight,
  parseDateKey,
  parseNaiveIso,
  toDateKey,
  toUtcBoundary,
} from "@/lib/utils";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface FreeSlotViewerProps {
  /** Bump this to force a refetch (e.g. after new engagements were added elsewhere). */
  refreshSignal?: number;
  /**
   * The saved shift, used for the day-start/day-end window. The parent
   * should remount this component (e.g. via a `key` tied to the shift's
   * save version) when the shift changes, so this only needs to be read
   * once per mount rather than reactively synced.
   */
  initialShift: ShiftSettings;
  /**
   * Set this (a new object each time, even for the same date) to jump the
   * viewer straight into that day's detail view — e.g. from EngagementList's
   * "view on calendar" action. A fresh object identity is required so
   * clicking the same date twice in a row re-triggers the jump.
   */
  focusRequest?: { dateKey: string } | null;
}

function addDaysKey(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function endOfMonthKey(monthCursor: Date): string {
  return toDateKey(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0));
}

/** The visible grid for a month: full weeks (Sun–Sat), padded with the tail of the previous month and the head of the next. */
function getMonthGridDays(monthCursor: Date): Date[] {
  const start = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

interface BlockStyle {
  leftPct: number;
  widthPct: number;
}

/** Per-day rollup used to render the month-grid cell's dots, count badge, free-time meter, numeric stats, and tooltip. */
interface DaySummary {
  categories: Set<EngagementCategory>;
  categoryCounts: Map<EngagementCategory, number>;
  hasFree: boolean;
  freeMinutes: number;
  busyMinutes: number;
  engagementCount: number;
  longestFree: (DayInterval & { minutes: number }) | null;
  longestBusy: (DayInterval & { minutes: number }) | null;
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

interface DayInterval {
  start: Date;
  end: Date;
}

/** Same clipping as `clipToWindow`, but keeps real timestamps instead of percentages — used for the day-stats numbers. */
function clipInterval(start: Date, end: Date, windowStart: Date, windowEnd: Date): DayInterval | null {
  if (end <= windowStart || start >= windowEnd) return null;
  const clippedStart = start < windowStart ? windowStart : start;
  const clippedEnd = end > windowEnd ? windowEnd : end;
  return clippedEnd > clippedStart ? { start: clippedStart, end: clippedEnd } : null;
}

/** Collapses overlapping/back-to-back intervals (e.g. two adjacent meetings) into single busy stretches. */
function mergeIntervals(intervals: DayInterval[]): DayInterval[] {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: DayInterval[] = [];
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

function intervalMinutes(interval: DayInterval): number {
  return Math.round((interval.end.getTime() - interval.start.getTime()) / 60_000);
}

function longestInterval(intervals: DayInterval[]): (DayInterval & { minutes: number }) | null {
  let best: (DayInterval & { minutes: number }) | null = null;
  for (const interval of intervals) {
    const minutes = intervalMinutes(interval);
    if (!best || minutes > best.minutes) best = { ...interval, minutes };
  }
  return best;
}

interface DayStats {
  freeMinutesTotal: number;
  busyMinutesTotal: number;
  longestFree: (DayInterval & { minutes: number }) | null;
  longestBusy: (DayInterval & { minutes: number }) | null;
}

/**
 * Numeric summary for the single-day drill-in view: total free/busy time
 * across the calendar day, plus the single longest free window and longest
 * unbroken busy stretch (adjacent/overlapping engagements merged first).
 */
function computeDayStats(day: Date, engagements: Engagement[], freeSlots: FreeSlotItem[]): DayStats {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

  const freeIntervals = freeSlots
    .map((slot) => clipInterval(parseNaiveIso(slot.start_time), parseNaiveIso(slot.end_time), dayStart, dayEnd))
    .filter((interval): interval is DayInterval => interval !== null);

  const busyIntervals = mergeIntervals(
    engagements
      .map((engagement) =>
        clipInterval(parseNaiveIso(engagement.start_time), parseNaiveIso(engagement.end_time), dayStart, dayEnd),
      )
      .filter((interval): interval is DayInterval => interval !== null),
  );

  return {
    freeMinutesTotal: freeIntervals.reduce((sum, interval) => sum + intervalMinutes(interval), 0),
    busyMinutesTotal: busyIntervals.reduce((sum, interval) => sum + intervalMinutes(interval), 0),
    longestFree: longestInterval(freeIntervals),
    longestBusy: longestInterval(busyIntervals),
  };
}

export default function FreeSlotViewer({ refreshSignal, initialShift, focusRequest }: FreeSlotViewerProps) {
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const target = parseDateKey(focusRequest.dateKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonthCursor(startOfMonth(target));
    setSelectedDayKey(focusRequest.dateKey);
  }, [focusRequest]);

  const dayStartHour = initialShift.day_start_hour.slice(0, 5);
  const dayEndHour = initialShift.day_end_hour.slice(0, 5);
  const minDurationMinutes = 30;

  const [freeSlots, setFreeSlots] = useState<FreeSlotItem[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // dayStartHour > dayEndHour is a valid overnight window (e.g. 18:00 to
  // 02:00, ending the next day) — only equal start/end is actually invalid.
  // ShiftSettingsForm guarantees they're never equal.
  const isOvernight = dayStartHour > dayEndHour;

  // Plain (non-memoized) function, recreated each render so it always closes
  // over the latest values — used by the mount/refresh/month-change effect below.
  async function loadData() {
    const dateFrom = toDateKey(monthCursor);
    const dateTo = endOfMonthKey(monthCursor);

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
    // after a chat action adds engagements elsewhere) or the visible month
    // changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
    // loadData is intentionally omitted — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal, monthCursor]);

  const dayStartMinutes = hourStringToMinutes(dayStartHour);
  const dayEndMinutes = hourStringToMinutes(dayEndHour);
  // Length of the daily shift window in minutes — the denominator for each
  // month-grid cell's free-time meter. Overnight shifts wrap past midnight.
  const shiftMinutes =
    dayStartMinutes > dayEndMinutes ? 24 * 60 - dayStartMinutes + dayEndMinutes : dayEndMinutes - dayStartMinutes;

  const blockingEngagements = useMemo(
    () => engagements.filter((engagement) => engagement.is_blocking),
    [engagements],
  );

  // Per-day summary (categories present, free/busy totals, longest stretch of
  // each) used to render the month-grid cell's dots, numeric stats, meter,
  // and tooltip. Keyed by the date each engagement/slot *starts* on — good
  // enough for an overview grid; the day-detail view clips to true day
  // boundaries via `computeDayStats`.
  const daySummaries = useMemo(() => {
    const busyByDay = new Map<string, DayInterval[]>();
    const freeByDay = new Map<string, DayInterval[]>();
    const categoryInfoByDay = new Map<
      string,
      { categories: Set<EngagementCategory>; categoryCounts: Map<EngagementCategory, number>; engagementCount: number }
    >();

    for (const engagement of blockingEngagements) {
      const start = parseNaiveIso(engagement.start_time);
      const key = toDateKey(start);
      const end = parseNaiveIso(engagement.end_time);
      const intervals = busyByDay.get(key) ?? [];
      intervals.push({ start, end });
      busyByDay.set(key, intervals);

      const catInfo =
        categoryInfoByDay.get(key) ??
        { categories: new Set<EngagementCategory>(), categoryCounts: new Map<EngagementCategory, number>(), engagementCount: 0 };
      catInfo.categories.add(engagement.category);
      catInfo.categoryCounts.set(engagement.category, (catInfo.categoryCounts.get(engagement.category) ?? 0) + 1);
      catInfo.engagementCount += 1;
      categoryInfoByDay.set(key, catInfo);
    }

    for (const slot of freeSlots) {
      const start = parseNaiveIso(slot.start_time);
      const key = toDateKey(start);
      const intervals = freeByDay.get(key) ?? [];
      intervals.push({ start, end: parseNaiveIso(slot.end_time) });
      freeByDay.set(key, intervals);
    }

    const allKeys = new Set([...busyByDay.keys(), ...freeByDay.keys()]);
    const map = new Map<string, DaySummary>();
    for (const key of allKeys) {
      const busyIntervals = mergeIntervals(busyByDay.get(key) ?? []);
      const freeIntervals = freeByDay.get(key) ?? [];
      const catInfo = categoryInfoByDay.get(key);
      map.set(key, {
        categories: catInfo?.categories ?? new Set<EngagementCategory>(),
        categoryCounts: catInfo?.categoryCounts ?? new Map<EngagementCategory, number>(),
        hasFree: freeIntervals.length > 0,
        freeMinutes: freeIntervals.reduce((sum, interval) => sum + intervalMinutes(interval), 0),
        busyMinutes: busyIntervals.reduce((sum, interval) => sum + intervalMinutes(interval), 0),
        engagementCount: catInfo?.engagementCount ?? 0,
        longestFree: longestInterval(freeIntervals),
        longestBusy: longestInterval(busyIntervals),
      });
    }
    return map;
  }, [blockingEngagements, freeSlots]);

  const selectedDayStats = useMemo(() => {
    if (!selectedDayKey) return null;
    return computeDayStats(parseDateKey(selectedDayKey), blockingEngagements, freeSlots);
  }, [selectedDayKey, blockingEngagements, freeSlots]);

  return (
    <section className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex shrink-0 items-center gap-2">
        <CalendarClock className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Daily Timeline &amp; Free Slots
        </h2>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      </div>

      {error && (
        <div className="mt-4 flex shrink-0 items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {selectedDayKey ? (
        <div className="mt-4 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedDayKey(null)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to month
            </button>
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {formatDayLabel(parseDateKey(selectedDayKey))}
            </span>
          </div>
          {selectedDayStats && (
            <div className="mt-3 flex flex-wrap gap-2">
              <StatChip label="Free" value={formatDuration(selectedDayStats.freeMinutesTotal)} tone="emerald" />
              <StatChip label="Busy" value={formatDuration(selectedDayStats.busyMinutesTotal)} tone="red" />
              {selectedDayStats.longestFree && (
                <StatChip
                  label="Longest free stretch"
                  value={`${formatDuration(selectedDayStats.longestFree.minutes)} · ${formatClockTime(
                    selectedDayStats.longestFree.start,
                  )}–${formatClockTime(selectedDayStats.longestFree.end)}`}
                  tone="emerald"
                />
              )}
              {selectedDayStats.longestBusy && (
                <StatChip
                  label="Busiest stretch"
                  value={`${formatDuration(selectedDayStats.longestBusy.minutes)} · ${formatClockTime(
                    selectedDayStats.longestBusy.start,
                  )}–${formatClockTime(selectedDayStats.longestBusy.end)}`}
                  tone="red"
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 flex shrink-0 items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMonthCursor((prev) => addMonths(prev, -1))}
              aria-label="Previous month"
              className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-36 text-center text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {formatMonthLabel(monthCursor)}
            </span>
            <button
              type="button"
              onClick={() => setMonthCursor((prev) => addMonths(prev, 1))}
              aria-label="Next month"
              className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setMonthCursor(startOfMonth(new Date()))}
            className="rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Today
          </button>
        </div>
      )}

      <div className="mt-4 min-h-0 flex-1">
        {selectedDayKey ? (
          <CalendarGrid
            days={[parseDateKey(selectedDayKey)]}
            dayStartMinutes={dayStartMinutes}
            dayEndMinutes={dayEndMinutes}
            engagements={blockingEngagements}
            freeSlots={freeSlots}
          />
        ) : (
          <MonthGrid
            monthCursor={monthCursor}
            daySummaries={daySummaries}
            shiftMinutes={shiftMinutes}
            onSelectDay={setSelectedDayKey}
          />
        )}
      </div>
    </section>
  );
}

/** Small labeled pill for a single day-stat (free/busy totals, longest stretches). */
function StatChip({ label, value, tone }: { label: string; value: string; tone: "emerald" | "red" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
        tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-500/10"
          : "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-500/10",
      )}
    >
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span
        className={cn(
          "font-semibold",
          tone === "emerald" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400",
        )}
      >
        {value}
      </span>
    </span>
  );
}

/** Turns per-category counts into a compact readable list, e.g. "Meeting ×2, Office Hours". */
function formatCategoryBreakdown(categoryCounts: Map<EngagementCategory, number>): string {
  const order: EngagementCategory[] = ["meeting", "interview", "office_hours", "personal"];
  return order
    .filter((category) => (categoryCounts.get(category) ?? 0) > 0)
    .map((category) => {
      const count = categoryCounts.get(category) ?? 0;
      return count > 1 ? `${CATEGORY_LABELS[category]} ×${count}` : CATEGORY_LABELS[category];
    })
    .join(", ");
}

/** Native `title` text for a month-grid cell — a text-based fallback for anyone not reading the dots/meter by color. */
function buildDayTooltip(day: Date, summary: DaySummary | undefined, freeFraction: number): string {
  if (!summary) return formatDayLabel(day);
  const breakdown = formatCategoryBreakdown(summary.categoryCounts);
  const freeText =
    summary.freeMinutes === 0 && summary.engagementCount > 0
      ? "Fully booked"
      : summary.engagementCount === 0 && freeFraction >= 0.99
        ? "Open all day"
        : summary.freeMinutes > 0
          ? `${formatDuration(summary.freeMinutes)} free`
          : null;
  const busyText = summary.busyMinutes > 0 ? `${formatDuration(summary.busyMinutes)} busy` : null;
  const detail = [breakdown, freeText, busyText].filter(Boolean).join(" • ") || "No events";
  return `${formatDayLabel(day)}\n${detail}`;
}

/** Compact numeric hour label for tight grid cells, e.g. 405min -> "6.8h", 180min -> "3h", 0 -> "0h". */
function formatCompactHours(minutes: number): string {
  if (minutes <= 0) return "0h";
  const hours = Math.round((minutes / 60) * 10) / 10;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/** Compact 12-hour clock label for tight grid cells, e.g. "6pm", "10:15am" — no space, but a full am/pm suffix so it isn't mistaken for a/p. */
function formatCompactHour(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const twelveHour = hours % 12 === 0 ? 12 : hours % 12;
  const suffix = hours < 12 ? "am" : "pm";
  return minutes === 0 ? `${twelveHour}${suffix}` : `${twelveHour}:${String(minutes).padStart(2, "0")}${suffix}`;
}

function formatCompactRange(interval: DayInterval): string {
  return `${formatCompactHour(interval.start)}–${formatCompactHour(interval.end)}`;
}

interface MonthGridProps {
  monthCursor: Date;
  daySummaries: Map<string, DaySummary>;
  shiftMinutes: number;
  onSelectDay: (dateKey: string) => void;
}

function MonthGrid({ monthCursor, daySummaries, shiftMinutes, onSelectDay }: MonthGridProps) {
  const gridDays = useMemo(() => getMonthGridDays(monthCursor), [monthCursor]);
  const weeksCount = gridDays.length / 7;
  const todayDateKey = toDateKey(new Date());

  return (
    <div className="flex h-full flex-col">
      <div className="grid shrink-0 grid-cols-7 gap-1 pb-1 text-center text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div
        className="grid flex-1 grid-cols-7 gap-1"
        style={{ gridTemplateRows: `repeat(${weeksCount}, minmax(0, 1fr))` }}
      >
        {gridDays.map((day) => {
          const dateKey = toDateKey(day);
          const inCurrentMonth = day.getMonth() === monthCursor.getMonth();
          const isToday = dateKey === todayDateKey;
          const summary = daySummaries.get(dateKey);
          const hasMeeting =
            summary?.categories.has("meeting") || summary?.categories.has("interview") || false;
          const hasOfficeHours =
            summary?.categories.has("office_hours") || summary?.categories.has("personal") || false;

          // Fraction of the daily shift window that's free — drives the meter bar below the dots.
          const freeFraction = summary && shiftMinutes > 0 ? Math.min(1, summary.freeMinutes / shiftMinutes) : 0;
          const isFullyOpen = Boolean(summary && summary.engagementCount === 0 && freeFraction >= 0.99);
          const isFullyBooked = Boolean(summary && summary.freeMinutes === 0 && summary.engagementCount > 0);
          const meterWidthPct = isFullyBooked ? 100 : Math.round(freeFraction * 100);

          return (
            <button
              key={dateKey}
              type="button"
              disabled={!inCurrentMonth}
              onClick={() => onSelectDay(dateKey)}
              title={inCurrentMonth ? buildDayTooltip(day, summary, freeFraction) : undefined}
              className={cn(
                "relative flex flex-col items-start gap-1.5 rounded-lg border p-2 pb-3.5 text-left transition",
                inCurrentMonth
                  ? "border-zinc-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-500/50 dark:hover:bg-emerald-500/5"
                  : "cursor-default border-transparent bg-transparent",
                inCurrentMonth &&
                  isFullyOpen &&
                  "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-500/5",
                inCurrentMonth &&
                  isFullyBooked &&
                  "border-red-200/70 bg-red-50/50 dark:border-red-900/40 dark:bg-red-500/5",
                isToday && "ring-2 ring-inset ring-emerald-500",
              )}
            >
              <span
                className={cn(
                  "text-xs font-medium",
                  inCurrentMonth ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-300 dark:text-zinc-700",
                )}
              >
                {day.getDate()}
              </span>

              {inCurrentMonth && summary && summary.engagementCount > 1 && (
                <span className="absolute right-1.5 top-1.5 text-[10px] font-medium tabular-nums text-zinc-400 dark:text-zinc-600">
                  {summary.engagementCount}
                </span>
              )}

              {inCurrentMonth && (hasMeeting || hasOfficeHours || summary?.hasFree) && (
                <span className="flex gap-1">
                  {hasMeeting && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                  {hasOfficeHours && <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />}
                  {summary?.hasFree && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </span>
              )}

              {inCurrentMonth && summary && (summary.freeMinutes > 0 || summary.busyMinutes > 0) && (
                <span className="flex w-full min-w-0 items-center gap-1 truncate text-[9px] font-semibold leading-none tabular-nums">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {formatCompactHours(summary.freeMinutes)}
                  </span>
                  <span className="text-zinc-300 dark:text-zinc-700">/</span>
                  <span className="text-red-500 dark:text-red-400">{formatCompactHours(summary.busyMinutes)}</span>
                </span>
              )}

              {inCurrentMonth && summary && (summary.longestFree || summary.longestBusy) && (
                <span className="flex w-full min-w-0 items-center gap-1 truncate text-[9px] leading-none tabular-nums">
                  {summary.longestFree && (
                    <span className="shrink-0 text-emerald-600/70 dark:text-emerald-400/70">
                      {formatCompactRange(summary.longestFree)}
                    </span>
                  )}
                  {summary.longestBusy && (
                    <span className="truncate text-red-500/70 dark:text-red-400/70">
                      {formatCompactRange(summary.longestBusy)}
                    </span>
                  )}
                </span>
              )}

              {inCurrentMonth && summary && shiftMinutes > 0 && (
                <span className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      isFullyBooked ? "bg-red-400 dark:bg-red-500/80" : "bg-emerald-500 dark:bg-emerald-500/90",
                    )}
                    style={{ width: `${meterWidthPct}%` }}
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const HOUR_HEIGHT_PX = 48;
const GRID_HEIGHT_PX = HOUR_HEIGHT_PX * 24;
const DAY_COLUMN_MIN_WIDTH_PX = 130;
const HOUR_LABEL_COLUMN_WIDTH_PX = 52;
/** Height of the sticky day-header row above the hour grid — the scroll-to-shift effect has to offset by this. */
const HEADER_ROW_HEIGHT_PX = 48;

function minutesToDate(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/** A block positioned vertically in a day column, as top/height percentages of the 24h grid. */
interface PositionedBlock<T> {
  item: T;
  topPct: number;
  heightPct: number;
}

/** Same block, additionally assigned a side-by-side column among whatever else overlaps it. */
interface LaidOutBlock<T> extends PositionedBlock<T> {
  col: number;
  cols: number;
}

/**
 * Groups overlapping blocks into clusters and greedily assigns each one a
 * side-by-side column within its cluster, so concurrent engagements render
 * next to each other (like Google Calendar) instead of stacking on top.
 */
function layoutOverlaps<T>(blocks: PositionedBlock<T>[]): LaidOutBlock<T>[] {
  const sorted = [...blocks].sort((a, b) => a.topPct - b.topPct);
  const result: LaidOutBlock<T>[] = [];

  let cluster: PositionedBlock<T>[] = [];
  let clusterEndPct = -Infinity;

  function flushCluster() {
    if (cluster.length === 0) return;
    const columnEndPcts: number[] = [];
    for (const block of cluster) {
      let col = columnEndPcts.findIndex((end) => end <= block.topPct);
      if (col === -1) {
        col = columnEndPcts.length;
        columnEndPcts.push(block.topPct + block.heightPct);
      } else {
        columnEndPcts[col] = block.topPct + block.heightPct;
      }
      result.push({ ...block, col, cols: -1 });
    }
    const cols = columnEndPcts.length;
    for (let i = result.length - cluster.length; i < result.length; i++) {
      result[i] = { ...result[i], cols };
    }
    cluster = [];
  }

  for (const block of sorted) {
    if (cluster.length === 0 || block.topPct < clusterEndPct) {
      cluster.push(block);
      clusterEndPct = Math.max(clusterEndPct, block.topPct + block.heightPct);
    } else {
      flushCluster();
      cluster = [block];
      clusterEndPct = block.topPct + block.heightPct;
    }
  }
  flushCluster();

  return result;
}

interface CalendarGridProps {
  days: Date[];
  dayStartMinutes: number;
  dayEndMinutes: number;
  engagements: Engagement[];
  freeSlots: FreeSlotItem[];
}

function CalendarGrid({ days, dayStartMinutes, dayEndMinutes, engagements, freeSlots }: CalendarGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    const target = HEADER_ROW_HEIGHT_PX + Math.max(0, (dayStartMinutes / 60 - 1) * HOUR_HEIGHT_PX);
    scrollRef.current.scrollTop = target;
  }, [dayStartMinutes, dayEndMinutes]);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700"
    >
      <div className="flex" style={{ minWidth: HOUR_LABEL_COLUMN_WIDTH_PX + days.length * DAY_COLUMN_MIN_WIDTH_PX }}>
        <div
          className="sticky left-0 z-20 shrink-0 bg-white dark:bg-zinc-900"
          style={{ width: HOUR_LABEL_COLUMN_WIDTH_PX }}
        >
          <div className="sticky top-0 z-30 h-12 border-b border-r border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/60" />
          <div className="relative border-r border-zinc-200 dark:border-zinc-700" style={{ height: GRID_HEIGHT_PX }}>
            {Array.from({ length: 24 }, (_, hour) => (
              <span
                key={hour}
                className="absolute right-1.5 whitespace-nowrap text-[10px] text-zinc-400 dark:text-zinc-500"
                style={{ top: hour * HOUR_HEIGHT_PX, transform: hour === 0 ? undefined : "translateY(-50%)" }}
              >
                {formatHourLabel(hour)}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-1">
          {days.map((day) => (
            <DayColumn
              key={toDateKey(day)}
              day={day}
              dayStartMinutes={dayStartMinutes}
              dayEndMinutes={dayEndMinutes}
              engagements={engagements}
              freeSlots={freeSlots}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface DayColumnProps {
  day: Date;
  dayStartMinutes: number;
  dayEndMinutes: number;
  engagements: Engagement[];
  freeSlots: FreeSlotItem[];
}

function DayColumn({ day, dayStartMinutes, dayEndMinutes, engagements, freeSlots }: DayColumnProps) {
  // dayStartMinutes > dayEndMinutes means the shift is overnight (e.g. 18:00
  // to 02:00) — it recurs daily as two segments: the evening it starts, and
  // the tail end carrying into the following morning.
  const isOvernight = dayStartMinutes > dayEndMinutes;

  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
  const dayEnd = minutesToDate(dayStart, 24 * 60);

  const shiftBlocks = (
    isOvernight ? [[dayStartMinutes, 24 * 60], [0, dayEndMinutes]] : [[dayStartMinutes, dayEndMinutes]]
  )
    .map(([start, end]) =>
      clipToWindow(minutesToDate(dayStart, start), minutesToDate(dayStart, end), dayStart, dayEnd),
    )
    .filter((style): style is BlockStyle => style !== null)
    .map((style) => ({ topPct: style.leftPct, heightPct: style.widthPct }));

  const freeBlocks = freeSlots
    .map((slot) => {
      const style = clipToWindow(parseNaiveIso(slot.start_time), parseNaiveIso(slot.end_time), dayStart, dayEnd);
      return style ? { item: slot, topPct: style.leftPct, heightPct: style.widthPct } : null;
    })
    .filter((entry): entry is PositionedBlock<FreeSlotItem> => entry !== null);

  const busyBlocks = layoutOverlaps(
    engagements
      .map((engagement) => {
        const style = clipToWindow(
          parseNaiveIso(engagement.start_time),
          parseNaiveIso(engagement.end_time),
          dayStart,
          dayEnd,
        );
        return style ? { item: engagement, topPct: style.leftPct, heightPct: style.widthPct } : null;
      })
      .filter((entry): entry is PositionedBlock<Engagement> => entry !== null),
  );

  const isToday = toDateKey(day) === toDateKey(new Date());
  const nowTopPct = isToday ? (minutesSinceMidnight(new Date()) / (24 * 60)) * 100 : null;

  return (
    <div className="relative min-w-0 flex-1 border-l border-zinc-200 first:border-l-0 dark:border-zinc-700">
      <div className="sticky top-0 z-10 h-12 border-b border-zinc-200 bg-zinc-50 px-2 py-2 text-center dark:border-zinc-700 dark:bg-zinc-800/60">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{formatDayLabel(day)}</span>
      </div>

      <div className="relative" style={{ height: GRID_HEIGHT_PX }}>
        {Array.from({ length: 23 }, (_, index) => (
          <div
            key={index}
            className="absolute inset-x-0 border-t border-zinc-100 dark:border-zinc-800"
            style={{ top: (index + 1) * HOUR_HEIGHT_PX }}
          />
        ))}

        {shiftBlocks.map((block, index) => (
          <div
            key={`shift-${index}`}
            className="absolute inset-x-0 z-0 bg-indigo-400/30 dark:bg-indigo-400/15"
            style={{ top: `${block.topPct}%`, height: `${block.heightPct}%` }}
          />
        ))}

        {freeBlocks.map(({ item: slot, topPct, heightPct }, index) => (
          <div
            key={`free-${index}`}
            title={`Free: ${formatTime(slot.start_time)} – ${formatTime(slot.end_time)} (${formatDuration(
              slot.duration_minutes,
            )})`}
            className="absolute inset-x-1 z-10 overflow-hidden rounded-md bg-emerald-500 px-1.5 py-0.5 text-[11px] font-medium text-white dark:bg-emerald-500/90"
            style={{ top: `${topPct}%`, height: `${heightPct}%` }}
          >
            {heightPct > 3 && <span className="truncate">{formatDuration(slot.duration_minutes)}</span>}
          </div>
        ))}

        {busyBlocks.map(({ item: engagement, topPct, heightPct, col, cols }) => {
          const timeRange = `${formatTime(engagement.start_time)} – ${formatTime(engagement.end_time)}`;
          // Pixel height (not just heightPct) decides how the time fits: tall
          // enough for two lines, a single combined line for short (e.g.
          // 30min) meetings, or title-only when there's no room for either.
          const blockPx = (heightPct / 100) * GRID_HEIGHT_PX;
          return (
            <div
              key={engagement.id}
              title={`${engagement.title} — ${CATEGORY_LABELS[engagement.category]} (${timeRange})`}
              className={`absolute z-20 overflow-hidden rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white ${CATEGORY_BLOCK_CLASSES[engagement.category]}`}
              style={{
                top: `${topPct}%`,
                height: `${heightPct}%`,
                left: `calc(${(col / cols) * 100}% + 2px)`,
                width: `calc(${100 / cols}% - 4px)`,
              }}
            >
              {blockPx >= 32 ? (
                <>
                  <span className="block truncate">{engagement.title}</span>
                  <span className="block truncate text-[10px] text-white/80">{timeRange}</span>
                </>
              ) : (
                <span className="block truncate">
                  {engagement.title}
                  {blockPx >= 14 && <span className="text-white/80"> · {timeRange}</span>}
                </span>
              )}
            </div>
          );
        })}

        {nowTopPct !== null && (
          <div className="absolute inset-x-0 z-30" style={{ top: `${nowTopPct}%` }}>
            <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
            <div className="border-t-2 border-red-500" />
          </div>
        )}
      </div>
    </div>
  );
}
