"use client";

import { Sparkles } from "lucide-react";

import JulieControl from "./JulieControl";

/**
 * Persistent header above the routed page content, on every page — this is
 * what makes the "Julie" voice assistant reachable from anywhere in the app
 * instead of only from the Chat page. On mobile it also carries the brand
 * mark, since the sidebar (which normally shows it) is hidden there.
 */
export default function AppHeader() {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900 md:px-6">
      <div className="flex items-center gap-2 md:hidden">
        <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Personal Assistant</span>
      </div>
      <div className="hidden md:block" />
      <JulieControl />
    </header>
  );
}
