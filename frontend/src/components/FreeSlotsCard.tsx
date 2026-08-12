"use client";

import { useState } from "react";
import { addDays, addMinutes, differenceInMinutes, format, isToday, isTomorrow, startOfDay } from "date-fns";
import { CalendarCheck, Check, Copy } from "lucide-react";

import type { BusyEngagementInfo, FreeSlotItem, ShiftSettings } from "@/lib/types";
import {
  CATEGORY_LABELS,
  cn,
  COMMON_TIMEZONES,
  dateKeyInZone,
  formatDayLabelInZone,
  formatDuration,
  formatTimeInZone,
  hourStringToMinutes,
  timeZoneAbbreviation,
} from "@/lib/utils";

const SEGMENT_MINUTES = 30;

interface FreeSlotsCardProps {
  /**
   * Offset-aware, already in the user's local timezone (see the `free_slots`
   * doc comment on `ChatMessageResponse`) — parse directly with `new Date`.
   */
  slots: FreeSlotItem[];
  /** What's occupying the busy stretches, for the tooltip — same
   * offset-aware-local convention as `slots`. */
  busyEngagements: BusyEngagementInfo[];
  /** Used to bound each day's bar to the actual shift window — a slot list
   * alone doesn't say where the shift starts/ends on a day that's fully busy
   * at one edge (or fully booked, though that day just won't appear here). */
  shift: ShiftSettings;
  /** When set (a conflict or check_availability turn), segment(s) overlapping
   * this exact time range get a ring highlight — teal if it landed on a free
   * stretch (confirming availability), amber if busy (the conflict). */
  highlightRange?: { start: string; end: string };
}

interface Interval {
  start: Date;
  end: Date;
}

function dayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "EEE, MMM d");
}

function intervalRangeLabel(interval: Interval): string {
  return `${format(interval.start, "h:mm a")} – ${format(interval.end, "h:mm a")}`;
}

/** The gaps between free slots (and between the window edges and the nearest
 * free slot) within a day's shift window — i.e. the busy time, derived
 * purely from what's NOT free, since free = shift minus busy by construction. */
function buildBusyIntervals(windowStart: Date, windowEnd: Date, freeSlots: FreeSlotItem[]): Interval[] {
  const sorted = [...freeSlots].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
  );
  const busy: Interval[] = [];
  let cursor = windowStart;
  for (const slot of sorted) {
    const slotStart = new Date(slot.start_time);
    const slotEnd = new Date(slot.end_time);
    if (slotStart > cursor) busy.push({ start: cursor, end: slotStart });
    if (slotEnd > cursor) cursor = slotEnd;
  }
  if (cursor < windowEnd) busy.push({ start: cursor, end: windowEnd });
  return busy;
}

/** The engagement (if any) actually covering a given instant — used to
 * resolve a segment to the specific meeting it falls in, rather than
 * whichever meeting happens to overlap the wider merged busy block it sits
 * inside (that block may span several back-to-back meetings plus buffer). */
function findBusyEngagementAt(instant: Date, busyEngagements: BusyEngagementInfo[]): BusyEngagementInfo | undefined {
  return busyEngagements.find((engagement) => {
    const start = new Date(engagement.start_time);
    const end = new Date(engagement.end_time);
    return start <= instant && end > instant;
  });
}

function overlapsRange(interval: Interval, range?: { start: string; end: string }): boolean {
  if (!range) return false;
  const rangeStart = new Date(range.start);
  const rangeEnd = new Date(range.end);
  return interval.start < rangeEnd && interval.end > rangeStart;
}

/** Plain-text availability summary, grouped and worded in `timeZone` — ready
 * to paste into an email/message reply to whoever asked when you're free. */
function buildAvailabilityText(slots: FreeSlotItem[], timeZone: string): string {
  const byDay = new Map<string, { label: string; ranges: string[] }>();
  for (const slot of slots) {
    const start = new Date(slot.start_time);
    const end = new Date(slot.end_time);
    const key = dateKeyInZone(start, timeZone);
    const entry = byDay.get(key) ?? { label: formatDayLabelInZone(start, timeZone), ranges: [] };
    entry.ranges.push(`${formatTimeInZone(start, timeZone)}–${formatTimeInZone(end, timeZone)}`);
    byDay.set(key, entry);
  }
  const abbreviation = timeZoneAbbreviation(new Date(slots[0].start_time), timeZone);
  const lines = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { label, ranges }]) => `• ${label}: ${ranges.join(", ")}`);
  return `Here's my availability (${abbreviation}):\n${lines.join("\n")}`;
}

export default function FreeSlotsCard({ slots, busyEngagements, shift, highlightRange }: FreeSlotsCardProps) {
  const [targetTimeZone, setTargetTimeZone] = useState(shift.timezone);
  const [copied, setCopied] = useState(false);

  if (slots.length === 0) return null;

  const timeZoneOptions = [
    { label: `My timezone (${shift.timezone})`, value: shift.timezone },
    ...COMMON_TIMEZONES.filter((zone) => zone.value !== shift.timezone),
  ];

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildAvailabilityText(slots, targetTimeZone));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — silently
      // no-op rather than surfacing an error for a low-stakes convenience action.
    }
  }

  const dayStartMinutes = hourStringToMinutes(shift.day_start_hour.slice(0, 5));
  const dayEndMinutes = hourStringToMinutes(shift.day_end_hour.slice(0, 5));
  const isOvernight = dayStartMinutes > dayEndMinutes;
  const shiftDurationMinutes = isOvernight
    ? 24 * 60 - dayStartMinutes + dayEndMinutes
    : dayEndMinutes - dayStartMinutes;
  const segmentCount = Math.max(1, Math.round(shiftDurationMinutes / SEGMENT_MINUTES));

  const byDay = new Map<string, { date: Date; slots: FreeSlotItem[] }>();
  for (const slot of slots) {
    const start = new Date(slot.start_time);
    const key = format(start, "yyyy-MM-dd");
    const entry = byDay.get(key) ?? { date: start, slots: [] };
    entry.slots.push(slot);
    byDay.set(key, entry);
  }

  return (
    <div className="w-full space-y-3 rounded-xl border border-teal-200 bg-teal-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-700">
          <CalendarCheck className="h-3.5 w-3.5" />
          Available slots
        </div>
        <div className="flex items-center gap-2.5 text-[10px] text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-teal-500" />
            Free
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-slate-300" />
            Busy
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-teal-200/70 pt-2.5">
        <select
          value={targetTimeZone}
          onChange={(event) => setTargetTimeZone(event.target.value)}
          aria-label="Timezone for copied availability"
          className="rounded-lg border border-teal-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30"
        >
          {timeZoneOptions.map((zone) => (
            <option key={zone.value} value={zone.value}>
              {zone.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition",
            copied
              ? "bg-teal-600 text-white"
              : "bg-white text-teal-700 ring-1 ring-inset ring-teal-300 hover:bg-teal-100",
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied!" : "Copy as reply"}
        </button>
      </div>

      <div className="space-y-4">
        {[...byDay.values()].map(({ date, slots: daySlots }) => {
          const windowStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
          windowStart.setHours(0, dayStartMinutes, 0, 0);
          const windowEnd = addMinutes(windowStart, shiftDurationMinutes);

          const freeIntervals: Interval[] = daySlots.map((slot) => ({
            start: new Date(slot.start_time),
            end: new Date(slot.end_time),
          }));
          const busyIntervals = buildBusyIntervals(windowStart, windowEnd, daySlots);

          const segments = Array.from({ length: segmentCount }, (_, index) => {
            const segStart = addMinutes(windowStart, index * SEGMENT_MINUTES);
            const segMid = addMinutes(segStart, SEGMENT_MINUTES / 2);
            const freeMatch = freeIntervals.find((iv) => iv.start <= segMid && iv.end > segMid);
            if (freeMatch) return { isFree: true as const, interval: freeMatch, engagement: undefined };
            // Resolve to the specific engagement covering this segment (if
            // any) rather than the merged busy block it sits inside, which
            // may span several back-to-back meetings plus buffer time.
            const engagementMatch = findBusyEngagementAt(segMid, busyEngagements);
            if (engagementMatch) {
              return {
                isFree: false as const,
                interval: { start: new Date(engagementMatch.start_time), end: new Date(engagementMatch.end_time) },
                engagement: engagementMatch,
              };
            }
            const busyMatch = busyIntervals.find((iv) => iv.start <= segMid && iv.end > segMid) ?? {
              start: segStart,
              end: addMinutes(segStart, SEGMENT_MINUTES),
            };
            return { isFree: false as const, interval: busyMatch, engagement: undefined };
          });

          // Where the calendar date rolls over within an overnight bar, so
          // the "new day starts here" boundary the shift crosses is visible.
          const nextMidnight = addDays(startOfDay(windowStart), 1);
          const midnightPct =
            isOvernight && nextMidnight < windowEnd
              ? (differenceInMinutes(nextMidnight, windowStart) / shiftDurationMinutes) * 100
              : null;

          return (
            <div key={format(date, "yyyy-MM-dd")}>
              <div className="mb-1 text-xs font-medium text-zinc-600">{dayLabel(date)}</div>
              <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-400">
                <span>{format(windowStart, "h:mm a")}</span>
                <span>{format(windowEnd, "h:mm a")}</span>
              </div>
              <div className="relative pb-3">
                <div className="flex h-6 gap-px">
                  {segments.map(({ isFree, interval, engagement }, index) => {
                    const isHighlighted = overlapsRange(interval, highlightRange);
                    return (
                      <div key={index} className="group relative flex-1">
                        <div
                          className={cn(
                            "h-6",
                            isFree ? "bg-teal-500" : isHighlighted ? "bg-slate-500" : "bg-slate-300",
                            isHighlighted && (isFree ? "ring-2 ring-teal-700 ring-offset-1" : "ring-2 ring-amber-500 ring-offset-1"),
                            index === 0 && "rounded-l-md",
                            index === segments.length - 1 && "rounded-r-md",
                          )}
                        />
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 flex-col items-center group-hover:flex">
                          <div className="max-w-[180px] whitespace-normal rounded-lg bg-zinc-900 px-2.5 py-1.5 text-center shadow-lg">
                            <div className="text-[11px] font-semibold text-white">
                              {isFree ? "Free" : (engagement?.title ?? "Busy")}
                              {isHighlighted && (isFree ? " ✓" : " ⚠")}
                            </div>
                            {engagement && (
                              <div className="text-[10px] text-zinc-400">{CATEGORY_LABELS[engagement.category]}</div>
                            )}
                            <div className="whitespace-nowrap text-[10px] text-zinc-300">
                              {intervalRangeLabel(interval)}
                            </div>
                            <div className="whitespace-nowrap text-[10px] text-zinc-400">
                              {formatDuration(differenceInMinutes(interval.end, interval.start))}
                            </div>
                          </div>
                          <div className="-mt-[3px] h-1.5 w-1.5 shrink-0 rotate-45 bg-zinc-900" />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {midnightPct !== null && (
                  <div
                    className="absolute top-0 h-6 w-px -translate-x-1/2 bg-white"
                    style={{ left: `${midnightPct}%` }}
                  />
                )}
                {midnightPct !== null && (
                  <span
                    className="absolute top-6 -translate-x-1/2 whitespace-nowrap text-[10px] text-zinc-400"
                    style={{ left: `${midnightPct}%` }}
                  >
                    {format(nextMidnight, "MMM d")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
