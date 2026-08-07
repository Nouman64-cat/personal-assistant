"use client";

import { useCallback, useEffect, useState } from "react";

import EngagementList from "@/components/EngagementList";
import FreeSlotViewer from "@/components/FreeSlotViewer";
import QuickParseInput from "@/components/QuickParseInput";
import ShiftSettingsForm from "@/components/ShiftSettingsForm";
import { ApiError, getShiftSettings } from "@/lib/api";
import type { ShiftSettings } from "@/lib/types";

export default function Home() {
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [shift, setShift] = useState<ShiftSettings | null>(null);
  const [shiftLoadError, setShiftLoadError] = useState<string | null>(null);
  // Bumped only when the shift itself is saved, so FreeSlotViewer can reset
  // its filters to the new values via a `key` remount without also reacting
  // to unrelated data refreshes (which should leave in-progress filter edits alone).
  const [shiftVersion, setShiftVersion] = useState(0);

  const triggerRefresh = useCallback(() => {
    setRefreshSignal((previous) => previous + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getShiftSettings()
      .then((data) => {
        if (!cancelled) setShift(data);
      })
      .catch((caught) => {
        if (!cancelled) {
          setShiftLoadError(
            caught instanceof ApiError ? caught.message : "Failed to load shift settings.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleShiftSaved(updated: ShiftSettings) {
    setShift(updated);
    setShiftVersion((previous) => previous + 1);
    triggerRefresh();
  }

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
            <QuickParseInput onAdded={triggerRefresh} timezone={shift?.timezone} />
            {shift ? (
              <ShiftSettingsForm key={shiftVersion} shift={shift} onSaved={handleShiftSaved} />
            ) : (
              <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                {shiftLoadError ?? "Loading your shift settings…"}
              </section>
            )}
            <EngagementList refreshSignal={refreshSignal} onChanged={triggerRefresh} />
          </div>
          {shift ? (
            <FreeSlotViewer key={shiftVersion} refreshSignal={refreshSignal} initialShift={shift} />
          ) : (
            <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              {shiftLoadError ? "Couldn't load availability." : "Loading your availability…"}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
