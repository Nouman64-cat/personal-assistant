"use client";

import { useState } from "react";
import { AlertTriangle, Check, Clock, Loader2 } from "lucide-react";

import { ApiError, updateShiftSettings } from "@/lib/api";
import type { ShiftSettings } from "@/lib/types";

interface ShiftSettingsFormProps {
  /**
   * Current saved shift, used to seed the form's initial state. The parent
   * should only mount this once the shift has loaded, and remount it (e.g.
   * via a `key` tied to the save version) if the shift changes externally —
   * this component treats `shift` as an initial value, not a live prop.
   */
  shift: ShiftSettings;
  onSaved: (shift: ShiftSettings) => void;
}

function toInputTime(value: string): string {
  return value.slice(0, 5);
}

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export default function ShiftSettingsForm({ shift, onSaved }: ShiftSettingsFormProps) {
  const [dayStartHour, setDayStartHour] = useState(toInputTime(shift.day_start_hour));
  const [dayEndHour, setDayEndHour] = useState(toInputTime(shift.day_end_hour));
  const [timezone, setTimezone] = useState(shift.timezone);
  const [bufferMinutes, setBufferMinutes] = useState(shift.buffer_minutes);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  function markDirty() {
    setJustSaved(false);
    setSaveError(null);
  }

  // Start > end is a valid overnight shift (e.g. 18:00 to 02:00, ending the
  // next day) — only equal start/end is actually invalid (ambiguous: 0h or 24h?).
  const rangeIsValid = dayStartHour !== dayEndHour;
  const isOvernight = dayStartHour > dayEndHour;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!rangeIsValid || isSaving) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await updateShiftSettings({
        day_start_hour: dayStartHour,
        day_end_hour: dayEndHour,
        timezone,
        buffer_minutes: bufferMinutes,
      });
      onSaved(updated);
      setJustSaved(true);
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : "Failed to save shift.");
    } finally {
      setIsSaving(false);
    }
  }

  const detected = detectBrowserTimezone();

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-sky-600 dark:text-sky-400" />
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">My Shift</h2>
      </div>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Your recurring working hours — this is what availability is checked against by default.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Starts">
            <input
              type="time"
              value={dayStartHour}
              onChange={(event) => {
                markDirty();
                setDayStartHour(event.target.value);
              }}
              className={inputClasses}
            />
          </Field>
          <Field label="Ends">
            <input
              type="time"
              value={dayEndHour}
              onChange={(event) => {
                markDirty();
                setDayEndHour(event.target.value);
              }}
              className={inputClasses}
            />
          </Field>
          <Field label="Timezone (IANA)">
            <input
              type="text"
              value={timezone}
              onChange={(event) => {
                markDirty();
                setTimezone(event.target.value);
              }}
              placeholder="e.g. Asia/Karachi"
              className={inputClasses}
            />
          </Field>
          <Field label="Buffer between engagements (min)">
            <input
              type="number"
              min={0}
              max={120}
              step={5}
              value={bufferMinutes}
              onChange={(event) => {
                markDirty();
                setBufferMinutes(Math.max(0, Math.min(120, Number(event.target.value) || 0)));
              }}
              className={inputClasses}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              markDirty();
              setTimezone(detected);
            }}
            className="text-xs font-medium text-sky-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-sky-400"
          >
            Use my browser&apos;s timezone ({detected})
          </button>
          <button
            type="submit"
            disabled={isSaving || !rangeIsValid}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save shift
          </button>
        </div>

        {!rangeIsValid ? (
          <p className="text-xs text-red-600 dark:text-red-400">Start and end must be different.</p>
        ) : (
          isOvernight && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Overnight shift — runs from {dayStartHour} until {dayEndHour} the next day.
            </p>
          )
        )}
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Suggested free slots keep at least {bufferMinutes} minute{bufferMinutes === 1 ? "" : "s"} of breathing
          room before and after every engagement — so back-to-back interviews never get offered with zero gap.
        </p>
      </form>

      {saveError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}
      {justSaved && (
        <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400">
          Saved — the availability view now uses this by default.
        </p>
      )}
    </section>
  );
}

const inputClasses =
  "w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}
