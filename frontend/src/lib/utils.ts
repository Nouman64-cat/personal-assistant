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
 * Parse a naive ISO-8601 datetime string (no timezone offset) into a `Date`
 * whose *local* getters (getHours, getDate, ...) return exactly the
 * wall-clock values encoded in the string. This lets us format and position
 * these timestamps without any timezone conversion, which matches how the
 * backend stores and reasons about them.
 */
export function parseNaiveIso(iso: string): Date {
  const [datePart, timePart = "00:00:00"] = iso.replace("Z", "").split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hourStr, minuteStr, secondStr] = timePart.split(":");
  return new Date(
    year,
    (month ?? 1) - 1,
    day ?? 1,
    Number(hourStr ?? 0),
    Number(minuteStr ?? 0),
    Math.trunc(Number(secondStr ?? 0)),
  );
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
