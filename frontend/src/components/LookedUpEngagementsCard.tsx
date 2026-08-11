import { CalendarSearch } from "lucide-react";

import type { LookedUpEngagement } from "@/lib/types";
import { CATEGORY_BADGE_CLASSES, CATEGORY_LABELS, cn, formatClockTime, formatDayLabel } from "@/lib/utils";

/** Renders engagement(s) a list_engagements lookup surfaced (e.g. "what's my
 * next meeting") as small cards, instead of leaving the answer as prose the
 * user has to parse for the actual time/title. */
export default function LookedUpEngagementsCard({ engagements }: { engagements: LookedUpEngagement[] }) {
  if (engagements.length === 0) return null;

  return (
    <div className="w-full space-y-1.5">
      {engagements.map((engagement) => {
        const start = new Date(engagement.start_time);
        const end = new Date(engagement.end_time);
        return (
          <div
            key={engagement.id}
            className="flex items-start gap-2.5 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-300"
          >
            <CalendarSearch className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "truncate rounded-full px-2 py-0.5 text-[10px] font-medium",
                    CATEGORY_BADGE_CLASSES[engagement.category],
                  )}
                >
                  {engagement.title}
                </span>
                <span className="text-[10px] text-current/70">{CATEGORY_LABELS[engagement.category]}</span>
              </div>
              <p className="mt-0.5 text-current/80">
                {formatDayLabel(start)} · {formatClockTime(start)} – {formatClockTime(end)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
