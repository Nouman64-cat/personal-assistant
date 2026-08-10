import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { BusyEngagementInfo, ConflictInfo, EngagementAction, FreeSlotItem, ShiftSettings } from "@/lib/types";
import { cn, formatClockTime } from "@/lib/utils";

import EngagementActionCard from "./EngagementActionCard";
import FreeSlotsCard from "./FreeSlotsCard";

interface ChatMessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  actions?: EngagementAction[];
  freeSlots?: FreeSlotItem[];
  busyEngagements?: BusyEngagementInfo[];
  /** Set whenever this turn checked a specific time window — a create/update
   * that hit a conflict, or a direct check_availability question. Renders a
   * banner (amber for a conflict, green for confirmed-available) and
   * highlights the checked window in the free-slots widget below. */
  conflict?: ConflictInfo | null;
  /** Needed to bound the free-slots timeline bar to the shift window; the
   * widget just doesn't render until the shift has loaded. */
  shift?: ShiftSettings | null;
}

/** Compact markdown styling to match the bubble's text-sm rhythm — the
 * default browser/prose spacing reads too loose inside a chat bubble. */
const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-zinc-900">{children}</strong>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-violet-600 underline underline-offset-2 hover:text-violet-700"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800">{children}</code>
  ),
};

export default function ChatMessageBubble({
  role,
  content,
  actions = [],
  freeSlots = [],
  busyEngagements = [],
  conflict = null,
  shift = null,
}: ChatMessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-2", isUser && "flex flex-col items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm",
            isUser
              ? "whitespace-pre-wrap bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-sm shadow-violet-500/20"
              : "border border-zinc-200 bg-white text-zinc-800 shadow-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100",
          )}
        >
          {isUser ? (
            content
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </ReactMarkdown>
          )}
        </div>
        {conflict &&
          (conflict.available ? (
            <div className="flex w-full items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Free from {formatClockTime(new Date(conflict.attempted_start_time))} to{" "}
                {formatClockTime(new Date(conflict.attempted_end_time))} — highlighted below.
              </span>
            </div>
          ) : (
            <div className="flex w-full items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>&quot;{conflict.attempted_title}&quot;</strong> (
                {formatClockTime(new Date(conflict.attempted_start_time))}–
                {formatClockTime(new Date(conflict.attempted_end_time))}) conflicts with{" "}
                <strong>&quot;{conflict.conflicting_with?.title}&quot;</strong> (
                {conflict.conflicting_with && formatClockTime(new Date(conflict.conflicting_with.start_time))}–
                {conflict.conflicting_with && formatClockTime(new Date(conflict.conflicting_with.end_time))}
                ), highlighted below.
              </span>
            </div>
          ))}
        {freeSlots.length > 0 && shift && (
          <FreeSlotsCard
            slots={freeSlots}
            busyEngagements={busyEngagements}
            shift={shift}
            highlightRange={
              conflict ? { start: conflict.attempted_start_time, end: conflict.attempted_end_time } : undefined
            }
          />
        )}
        {actions.length > 0 && (
          <div className="w-full space-y-1.5">
            {actions.map((action, index) => (
              <EngagementActionCard key={`${action.engagement.id}-${action.type}-${index}`} action={action} />
            ))}
            <Link
              href="/calendar"
              className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline"
            >
              View on Calendar
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
