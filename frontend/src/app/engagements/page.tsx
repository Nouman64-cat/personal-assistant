"use client";

import ShiftEngagementList from "@/components/ShiftEngagementList";
import { useAppState } from "@/lib/appState";

export default function EngagementsPage() {
  const { shift, shiftLoadError, refreshSignal, triggerRefresh } = useAppState();

  return (
    <div className="flex h-full w-full flex-col px-4 py-4 sm:px-6 sm:py-8">
      <header className="mb-4 shrink-0 sm:mb-6">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Engagements by Shift</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Everything on the calendar, grouped by shift instead of the calendar date it happens to start on.
        </p>
      </header>

      <div className="min-h-0 flex-1">
        {shift ? (
          <ShiftEngagementList shift={shift} refreshSignal={refreshSignal} onChanged={triggerRefresh} />
        ) : (
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {shiftLoadError ? "Couldn't load shift settings." : "Loading your shift settings…"}
          </section>
        )}
      </div>
    </div>
  );
}
