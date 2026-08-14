"use client";

import { Check } from "lucide-react";

import type { LookedUpEngagement } from "@/lib/types";
import { CATEGORY_BADGE_CLASSES, CATEGORY_LABELS, cn, formatClockTime, formatDayLabel } from "@/lib/utils";

/** Renders engagement(s) a list_engagements lookup surfaced (e.g. "what's my
 * next meeting") as small cards, instead of leaving the answer as prose the
 * user has to parse for the actual time/title.
 *
 * Past engagements (end_time < now) are automatically marked as Done with a
 * muted style and a ✓ badge. Ongoing ones get a pulsing "Now" pill. */
export default function LookedUpEngagementsCard({ engagements }: { engagements: LookedUpEngagement[] }) {
  if (engagements.length === 0) return null;

  const now = new Date();

  return (
    <div className="w-full space-y-1.5">
      {engagements.map((engagement) => {
        const start = new Date(engagement.start_time);
        const end = new Date(engagement.end_time);
        const isDone = end < now;
        const isNow = start <= now && now <= end;

        return (
          <div
            key={engagement.id}
            className={cn(
              "flex items-start gap-2.5 rounded-xl border p-3 text-xs transition",
              isDone
                ? "border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-500"
                : isNow
                  ? "border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900/50 dark:bg-teal-950/30 dark:text-teal-300"
                  : "border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-300",
            )}
          >
            {/* Left icon: checkmark circle for done, calendar otherwise */}
            {isDone ? (
              <div className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-zinc-300 dark:bg-zinc-600">
                <Check className="h-2 w-2 text-white dark:text-zinc-900" />
              </div>
            ) : (
              /* Coloured dot */
              <span
                className={cn(
                  "mt-1 h-2 w-2 shrink-0 rounded-full",
                  isNow ? "animate-pulse bg-teal-500" : "bg-violet-400",
                )}
              />
            )}

            <div className="min-w-0 flex-1">
              {/* Title row */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "truncate rounded-full px-2 py-0.5 text-[10px] font-medium",
                    isDone
                      ? "bg-zinc-200/80 text-zinc-400 line-through dark:bg-zinc-700 dark:text-zinc-500"
                      : CATEGORY_BADGE_CLASSES[engagement.category],
                  )}
                >
                  {engagement.title}
                </span>
                <span className="text-[10px] text-current/70">{CATEGORY_LABELS[engagement.category]}</span>

                {/* Status pills */}
                {isDone && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
                    <Check className="h-2.5 w-2.5" />
                    Done
                  </span>
                )}
                {isNow && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-900/40 dark:text-teal-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-500" />
                    Now
                  </span>
                )}
              </div>

              {/* Time */}
              <p className={cn("mt-0.5", isDone ? "text-zinc-400 dark:text-zinc-500" : "text-current/80")}>
                {formatDayLabel(start)} · {formatClockTime(start)} – {formatClockTime(end)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
