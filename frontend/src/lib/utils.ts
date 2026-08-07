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
