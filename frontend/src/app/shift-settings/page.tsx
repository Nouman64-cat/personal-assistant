"use client";

import ShiftSettingsForm from "@/components/ShiftSettingsForm";
import { useAppState } from "@/lib/appState";

export default function ShiftSettingsPage() {
  const { shift, shiftLoadError, handleShiftSaved } = useAppState();

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Shift Settings</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Your recurring working hours — the default window availability is checked against.
        </p>
      </header>

      {shift ? (
        <ShiftSettingsForm shift={shift} onSaved={handleShiftSaved} />
      ) : (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {shiftLoadError ?? "Loading your shift settings…"}
        </section>
      )}
    </div>
  );
}
