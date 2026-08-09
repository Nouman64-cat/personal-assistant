import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { EngagementAction } from "@/lib/types";
import { cn } from "@/lib/utils";

import EngagementActionCard from "./EngagementActionCard";

interface ChatMessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  actions?: EngagementAction[];
}

export default function ChatMessageBubble({ role, content, actions = [] }: ChatMessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-2", isUser && "flex flex-col items-end")}>
        <div
          className={cn(
            "whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm",
            isUser
              ? "bg-violet-600 text-white"
              : "border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
          )}
        >
          {content}
        </div>
        {actions.length > 0 && (
          <div className="w-full space-y-1.5">
            {actions.map((action, index) => (
              <EngagementActionCard key={`${action.engagement.id}-${action.type}-${index}`} action={action} />
            ))}
            <Link
              href="/calendar"
              className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
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
