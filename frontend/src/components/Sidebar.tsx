"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Clock, Layers, MessageSquare, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/calendar", label: "Calendar", icon: CalendarClock },
  { href: "/engagements", label: "Engagements", icon: Layers },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/shift-settings", label: "Shift Settings", icon: Clock },
] as const;

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-5 dark:border-zinc-800">
        <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Personal Assistant
        </span>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                isActive
                  ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
