import Link from "next/link";
import { ArrowRight } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { BusyEngagementInfo, EngagementAction, FreeSlotItem, ShiftSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

import EngagementActionCard from "./EngagementActionCard";
import FreeSlotsCard from "./FreeSlotsCard";

interface ChatMessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  actions?: EngagementAction[];
  freeSlots?: FreeSlotItem[];
  busyEngagements?: BusyEngagementInfo[];
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
  shift = null,
}: ChatMessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-2", isUser && "flex flex-col items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm",
            isUser ? "whitespace-pre-wrap bg-violet-600 text-white" : "border border-zinc-200 bg-white text-zinc-800",
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
        {freeSlots.length > 0 && shift && (
          <FreeSlotsCard slots={freeSlots} busyEngagements={busyEngagements} shift={shift} />
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
