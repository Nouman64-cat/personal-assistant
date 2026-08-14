"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, X, Clock, CalendarClock, BellRing } from "lucide-react";

import type { Engagement } from "@/lib/types";
import { CATEGORY_BADGE_CLASSES, CATEGORY_LABELS, cn, formatTime } from "@/lib/utils";
import { speakJulie, type SpeakHandle } from "@/lib/julieSpeak";

export interface AlarmToastData {
  engagement: Engagement;
  minutesUntil: number;
}

interface EngagementAlarmToastProps {
  alarm: AlarmToastData;
  onDismiss: (id: string) => void;
}

const CATEGORY_ACCENT: Record<string, string> = {
  meeting: "from-blue-500 to-blue-600",
  interview: "from-violet-500 to-violet-600",
  office_hours: "from-orange-500 to-orange-600",
  personal: "from-sky-500 to-sky-600",
};

const CATEGORY_RING_COLOR: Record<string, string> = {
  meeting: "ring-blue-400/40",
  interview: "ring-violet-400/40",
  office_hours: "ring-orange-400/40",
  personal: "ring-sky-400/40",
};

const CATEGORY_GLOW: Record<string, string> = {
  meeting: "shadow-blue-500/30",
  interview: "shadow-violet-500/30",
  office_hours: "shadow-orange-500/30",
  personal: "shadow-sky-500/30",
};

/** How long (ms) to wait after Julie finishes speaking before she repeats. */
const REPEAT_PAUSE_MS = 5_000;

/** Builds the spoken alarm message for a given engagement. */
function buildAlarmText(title: string, minutesUntil: number): string {
  const mins = minutesUntil === 1 ? "1 minute" : `${minutesUntil} minutes`;
  return `Sir, you have ${title} in ${mins}. Best of luck, sir.`;
}

export function EngagementAlarmToast({ alarm, onDismiss }: EngagementAlarmToastProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [ringing, setRinging] = useState(false);
  const speakHandleRef = useRef<SpeakHandle | null>(null);
  const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedRef = useRef(false);
  const { engagement, minutesUntil } = alarm;

  // Entrance animation
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, []);

  // Recurring Julie voice alarm — speak immediately, then repeat after a
  // pause once she finishes, until the user dismisses the toast.
  useEffect(() => {
    async function scheduleSpeak() {
      if (dismissedRef.current) return;

      const text = buildAlarmText(engagement.title, minutesUntil);
      const handle = speakJulie(text);
      speakHandleRef.current = handle;

      // Show the animated "ringing" state while Julie is speaking.
      setRinging(true);
      await handle.done;
      setRinging(false);

      if (dismissedRef.current) return;

      // Wait a moment, then speak again.
      repeatTimerRef.current = setTimeout(() => {
        void scheduleSpeak();
      }, REPEAT_PAUSE_MS);
    }

    void scheduleSpeak();

    return () => {
      // Cleanup on unmount (should normally be handled by dismiss() below,
      // but guard against forced unmounts).
      dismissedRef.current = true;
      speakHandleRef.current?.cancel();
      if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    dismissedRef.current = true;
    // Stop Julie mid-speech immediately.
    speakHandleRef.current?.cancel();
    if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
    setRinging(false);
    setExiting(true);
    setTimeout(() => onDismiss(engagement.id), 420);
  }

  const accent = CATEGORY_ACCENT[engagement.category] ?? "from-zinc-500 to-zinc-600";
  const ringColor = CATEGORY_RING_COLOR[engagement.category] ?? "ring-zinc-400/40";
  const glow = CATEGORY_GLOW[engagement.category] ?? "shadow-zinc-500/30";

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "relative w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border bg-white shadow-2xl dark:bg-zinc-900",
        glow,
        "border-zinc-200 dark:border-zinc-700",
        "transition-all duration-[420ms] ease-out",
        // Slide down from top
        visible && !exiting
          ? "translate-y-0 opacity-100 scale-100"
          : "-translate-y-4 opacity-0 scale-95",
        // Pulse the border while Julie is speaking
        ringing && `ring-4 ${ringColor}`,
      )}
    >
      {/* Top gradient accent bar */}
      <div className={cn("h-1.5 w-full bg-gradient-to-r", accent)} />

      <div className="px-5 py-4">
        {/* ── Header row ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Animated bell icon */}
            <div className="relative flex-shrink-0">
              <div
                className={cn(
                  "absolute -inset-2 rounded-full bg-gradient-to-br opacity-25 blur-md",
                  accent,
                  ringing ? "animate-ping" : "animate-pulse",
                )}
              />
              <div
                className={cn(
                  "relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br shadow-lg",
                  accent,
                )}
              >
                {ringing
                  ? <BellRing className="h-5 w-5 text-white animate-alarm-bell" />
                  : <Bell className="h-5 w-5 text-white" />}
              </div>
            </div>

            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                ⏰ Alarm — Upcoming in {minutesUntil} min
              </p>
              <p className="mt-0.5 truncate text-base font-bold text-zinc-900 dark:text-zinc-50">
                {engagement.title}
              </p>
              {ringing && (
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                  {/* Tiny equalizer bars while Julie is speaking */}
                  {[0, 80, 160].map((delay) => (
                    <span
                      key={delay}
                      className="inline-block h-2.5 w-0.5 rounded-full bg-current animate-voice-bar"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                  <span>Julie is speaking…</span>
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss alarm"
            className="flex-shrink-0 rounded-xl p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Time details grid ── */}
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
            <Clock className="h-3.5 w-3.5 flex-shrink-0 text-zinc-400" />
            <span className="text-xs text-zinc-600 dark:text-zinc-300">
              {formatTime(engagement.start_time)} – {formatTime(engagement.end_time)}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
            <CalendarClock className="h-3.5 w-3.5 flex-shrink-0 text-zinc-400" />
            <span className="text-xs text-zinc-600 dark:text-zinc-300">
              Starts{" "}
              <span className="font-semibold text-zinc-800 dark:text-zinc-100">
                {formatTime(engagement.start_time)}
              </span>
            </span>
          </div>
        </div>

        {/* ── Footer: category badge + dismiss ── */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <span
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-semibold",
              CATEGORY_BADGE_CLASSES[engagement.category],
            )}
          >
            {CATEGORY_LABELS[engagement.category]}
          </span>

          <button
            type="button"
            onClick={dismiss}
            className={cn(
              "rounded-xl px-5 py-2 text-sm font-semibold text-white shadow-md transition active:scale-95 bg-gradient-to-r hover:brightness-110",
              accent,
            )}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
