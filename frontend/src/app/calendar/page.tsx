"use client";

import { useState } from "react";

import EngagementList from "@/components/EngagementList";
import FreeSlotViewer from "@/components/FreeSlotViewer";
import { useAppState } from "@/lib/appState";

export default function CalendarPage() {
  const { shift, shiftLoadError, shiftVersion, refreshSignal, triggerRefresh } = useAppState();
  const [focusRequest, setFocusRequest] = useState<{ dateKey: string } | null>(null);
  const [filterDateKey, setFilterDateKey] = useState<string | null>(null);

  return (
    <div className="flex h-full w-full flex-col px-6 py-8">
      <header className="mb-6 shrink-0">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Calendar</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          See where you actually have time, and everything currently on the calendar.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-h-0 lg:col-span-2">
          {shift ? (
            <FreeSlotViewer
              key={shiftVersion}
              refreshSignal={refreshSignal}
              initialShift={shift}
              focusRequest={focusRequest}
              onDaySelect={setFilterDateKey}
            />
          ) : (
            <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              {shiftLoadError ? "Couldn't load availability." : "Loading your availability…"}
            </section>
          )}
        </div>
        <div className="min-h-0">
          <EngagementList
            refreshSignal={refreshSignal}
            onChanged={triggerRefresh}
            onSelectDate={(dateKey) => setFocusRequest({ dateKey })}
            filterDateKey={filterDateKey}
            onClearFilter={() => setFilterDateKey(null)}
          />
        </div>
      </div>
    </div>
  );
}
