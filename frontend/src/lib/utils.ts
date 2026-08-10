import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";

import type { EngagementCategory } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const CATEGORY_LABELS: Record<EngagementCategory, string> = {
  meeting: "Meeting",
  interview: "Interview",
  office_hours: "Office Hours",
  personal: "Personal",
};

/** Badge styling for compact category pills (cards, list rows). */
export const CATEGORY_BADGE_CLASSES: Record<EngagementCategory, string> = {
  meeting:
    "bg-red-500/15 text-red-700 dark:text-red-400 ring-1 ring-inset ring-red-500/30",
  interview:
    "bg-rose-500/15 text-rose-700 dark:text-rose-400 ring-1 ring-inset ring-rose-500/30",
  office_hours:
    "bg-orange-500/15 text-orange-700 dark:text-orange-400 ring-1 ring-inset ring-orange-500/30",
  personal:
    "bg-sky-500/15 text-sky-700 dark:text-sky-400 ring-1 ring-inset ring-sky-500/30",
};

/** Solid fill styling for timeline busy blocks — reds for meetings/interviews, orange for office hours/personal. */
export const CATEGORY_BLOCK_CLASSES: Record<EngagementCategory, string> = {
  meeting: "bg-red-500 dark:bg-red-500/90",
  interview: "bg-red-600 dark:bg-red-600/90",
  office_hours: "bg-orange-500 dark:bg-orange-500/90",
  personal: "bg-orange-400 dark:bg-orange-400/90",
};

/**
 * Parse a naive ISO-8601 datetime string from the backend (no timezone
 * offset) into a real `Date` instant. The backend stores every timestamp as
 * naive UTC, so we interpret the string as UTC here; from then on, all local
 * `Date` getters (and date-fns' `format`) automatically render it in the
 * viewer's own timezone.
 */
export function parseNaiveIso(iso: string): Date {
  return new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
}

export function toDateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function formatTime(iso: string): string {
  return format(parseNaiveIso(iso), "h:mm a");
}

/** Same as `formatTime`, but for a `Date` that's already wall-clock-correct
 * (e.g. one built directly via the local Date constructor), skipping the
 * naive-ISO parse. */
export function formatClockTime(date: Date): string {
  return format(date, "h:mm a");
}

export function formatDateTime(iso: string): string {
  return format(parseNaiveIso(iso), "EEE, MMM d 'at' h:mm a");
}

export function formatDayLabel(date: Date): string {
  return format(date, "EEE, MMM d");
}

export function formatMonthLabel(date: Date): string {
  return format(date, "MMMM yyyy");
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

export function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function hourStringToMinutes(hourString: string): number {
  const [hourStr, minuteStr] = hourString.split(":");
  return Number(hourStr ?? 0) * 60 + Number(minuteStr ?? 0);
}

/** A short set of commonly-needed zones for "copy my availability" style
 * features — picking from a handful of named options is far friendlier than
 * a free-text IANA zone input, and covers the vast majority of cross-zone
 * coordination (US business zones plus UTC/London). */
export const COMMON_TIMEZONES: { label: string; value: string }[] = [
  { label: "Eastern (New York)", value: "America/New_York" },
  { label: "Central (Chicago)", value: "America/Chicago" },
  { label: "Mountain (Denver)", value: "America/Denver" },
  { label: "Pacific (Los Angeles)", value: "America/Los_Angeles" },
  { label: "London", value: "Europe/London" },
  { label: "UTC", value: "UTC" },
];

/** Format an instant as a wall-clock time in an arbitrary IANA zone — used
 * to render a slot in whatever zone the *recipient* of a shared availability
 * message is in, independent of the viewer's own browser timezone. */
export function formatTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** Same as `formatDayLabel`, but for an arbitrary IANA zone rather than the
 * browser's own — the calendar date can differ from the viewer's local date
 * once converted (e.g. late-night PKT landing on the previous US morning). */
export function formatDayLabelInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** The short zone abbreviation (e.g. "EDT", "GMT+5") for an instant in a
 * given IANA zone — DST-aware, unlike a fixed offset baked in ahead of time. */
export function timeZoneAbbreviation(date: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(date)
    .find((entry) => entry.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** yyyy-MM-dd calendar-date key for an instant in an arbitrary IANA zone —
 * used to group slots by the *recipient's* calendar day, not the viewer's. */
export function dateKeyInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    date,
  );
}

/**
 * Convert a local wall-clock time (e.g. "09:00") on a given local calendar
 * date into its UTC equivalent. The backend has no timezone concept — it
 * takes `day_start_hour`/`day_end_hour` and `date_from`/`date_to` literally —
 * so the viewer's local "9 AM" has to become the matching UTC date + time
 * before being sent as a query param.
 */
export function toUtcBoundary(dateKey: string, localTime: string): { dateKey: string; time: string } {
  const [hour, minute] = localTime.split(":").map(Number);
  const local = parseDateKey(dateKey);
  local.setHours(hour, minute, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    dateKey: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}
