"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Clock, Layers, MessageSquare } from "lucide-react";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/calendar", label: "Calendar", icon: CalendarClock },
  { href: "/engagements", label: "Engagements", icon: Layers },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/shift-settings", label: "Shift", icon: Clock },
] as const;

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="flex shrink-0 items-stretch justify-around border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-zinc-800 dark:bg-zinc-900">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-medium transition",
              isActive
                ? "text-violet-700 dark:text-violet-400"
                : "text-zinc-500 dark:text-zinc-400",
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
