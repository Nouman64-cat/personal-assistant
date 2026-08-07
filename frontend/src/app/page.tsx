"use client";

import { useCallback, useState } from "react";

import EngagementList from "@/components/EngagementList";
import FreeSlotViewer from "@/components/FreeSlotViewer";
import QuickParseInput from "@/components/QuickParseInput";

export default function Home() {
  const [refreshSignal, setRefreshSignal] = useState(0);

  const triggerRefresh = useCallback(() => {
    setRefreshSignal((previous) => previous + 1);
  }, []);

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Personal Assistant
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Parse engagements from raw text and see where you actually have time.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <QuickParseInput onAdded={triggerRefresh} />
            <EngagementList refreshSignal={refreshSignal} onChanged={triggerRefresh} />
          </div>
          <FreeSlotViewer refreshSignal={refreshSignal} />
        </div>
      </main>
    </div>
  );
}
