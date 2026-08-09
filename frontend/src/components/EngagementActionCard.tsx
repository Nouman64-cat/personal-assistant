import { Pencil, Plus, Trash2 } from "lucide-react";

import type { EngagementAction } from "@/lib/types";
import { CATEGORY_BADGE_CLASSES, CATEGORY_LABELS, cn, formatDateTime, formatTime } from "@/lib/utils";

const ACTION_META = {
  created: {
    icon: Plus,
    label: "Created",
    classes: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400",
  },
  updated: {
    icon: Pencil,
    label: "Updated",
    classes: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-400",
  },
  deleted: {
    icon: Trash2,
    label: "Deleted",
    classes: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400",
  },
} as const;

export default function EngagementActionCard({ action }: { action: EngagementAction }) {
  const meta = ACTION_META[action.type];
  const Icon = meta.icon;
  const { engagement } = action;

  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-xs", meta.classes)}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">{meta.label}</span>
          <span
            className={cn(
              "truncate rounded-full px-2 py-0.5 text-[10px] font-medium",
              action.type === "deleted"
                ? "bg-black/5 text-current line-through dark:bg-white/10"
                : CATEGORY_BADGE_CLASSES[engagement.category],
            )}
          >
            {engagement.title}
          </span>
          <span className="text-[10px] text-current/70">{CATEGORY_LABELS[engagement.category]}</span>
        </div>
        <p className="mt-0.5 text-current/80">
          {formatDateTime(engagement.start_time)} – {formatTime(engagement.end_time)}
        </p>
      </div>
    </div>
  );
}
