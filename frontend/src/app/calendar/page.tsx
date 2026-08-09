"use client";

import EngagementList from "@/components/EngagementList";
import FreeSlotViewer from "@/components/FreeSlotViewer";
import { useAppState } from "@/lib/appState";

export default function CalendarPage() {
  const { shift, shiftLoadError, shiftVersion, refreshSignal, triggerRefresh } = useAppState();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Calendar</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          See where you actually have time, and everything currently on the calendar.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {shift ? (
            <FreeSlotViewer key={shiftVersion} refreshSignal={refreshSignal} initialShift={shift} />
          ) : (
            <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              {shiftLoadError ? "Couldn't load availability." : "Loading your availability…"}
            </section>
          )}
        </div>
        <div>
          <EngagementList refreshSignal={refreshSignal} onChanged={triggerRefresh} />
        </div>
      </div>
    </div>
  );
}
