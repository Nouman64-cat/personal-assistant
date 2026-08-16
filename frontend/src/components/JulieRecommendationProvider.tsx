"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getFreeSlots, getRecommendation, listEngagements } from "@/lib/api";
import { useAppState } from "@/lib/appState";
import { parseNaiveIso, toDateKey } from "@/lib/utils";
import { JulieRecommendationToast, type RecommendationToastData } from "./JulieRecommendationToast";

/**
 * Roughly how often Julie offers an unprompted suggestion while eligible.
 * Randomized within the window each cycle (rather than a fixed period) so it
 * doesn't feel like a metronome — see nextDelayMs.
 */
const MIN_INTERVAL_MS = 45 * 60_000;
const MAX_INTERVAL_MS = 60 * 60_000;

function nextDelayMs(): number {
  return MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
}

/**
 * Makes Julie get proactive: on a loose ~45-60 minute cadence, she checks
 * whether the user is currently inside a blocking engagement or an open free
 * slot (within their configured shift) and, if so, fetches and speaks a
 * short unprompted suggestion — a wellness nudge (water, stretch, a breather)
 * while busy, or a growth/learning idea while free. Fires as a toast + voice
 * regardless of whether Julie's wake-word mic is on, same as
 * EngagementAlarmProvider — this is independent of that hook (see
 * julieSpeak.ts's doc comment for why proactive speech never reaches into
 * useWakeWordVoice's singleton mic session).
 *
 * Silent no-op outside shift hours (neither busy nor free), while a
 * suggestion is already showing, or before shift settings have loaded.
 */
export function JulieRecommendationProvider({ children }: { children: React.ReactNode }) {
  const { shift } = useAppState();
  const shiftRef = useRef(shift);
  useEffect(() => {
    shiftRef.current = shift;
  }, [shift]);

  const [active, setActive] = useState<RecommendationToastData | null>(null);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
      if (cancelled) return;
      timer = setTimeout(() => void attempt(), nextDelayMs());
    }

    async function attempt() {
      if (cancelled) return;
      // Don't stack a second suggestion on top of one the user hasn't dismissed yet.
      const shift = shiftRef.current;
      if (activeRef.current || !shift) {
        schedule();
        return;
      }

      try {
        const now = new Date();
        const todayKey = toDateKey(now);
        const [engagements, freeSlots] = await Promise.all([
          listEngagements(),
          getFreeSlots({
            date_from: todayKey,
            date_to: todayKey,
            day_start_hour: shift.day_start_hour,
            day_end_hour: shift.day_end_hour,
          }),
        ]);
        if (cancelled) return;

        const isBusy = engagements.some(
          (engagement) =>
            engagement.is_blocking &&
            parseNaiveIso(engagement.start_time) <= now &&
            now < parseNaiveIso(engagement.end_time),
        );
        const isFree = freeSlots.slots.some(
          (slot) => parseNaiveIso(slot.start_time) <= now && now < parseNaiveIso(slot.end_time),
        );

        // Busy wins the tie if a slot computation edge case ever overlaps —
        // being mid-engagement is the stronger, more certain signal.
        const kind = isBusy ? "wellness" : isFree ? "growth" : null;
        if (kind) {
          const { text } = await getRecommendation(kind);
          if (cancelled || activeRef.current) return;
          setActive({ id: `${kind}-${now.getTime()}`, kind, text });
        }
      } catch {
        // Silent — proactive suggestions should never surface an error to the user.
      } finally {
        schedule();
      }
    }

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  function dismiss() {
    setActive(null);
  }

  return (
    <>
      {children}
      {typeof window !== "undefined" &&
        active &&
        createPortal(
          <div
            aria-label="Julie suggestion"
            className="pointer-events-none fixed inset-x-0 bottom-6 z-[9999] flex flex-col items-center gap-3 px-4 md:bottom-8"
          >
            <div className="pointer-events-auto">
              <JulieRecommendationToast data={active} onDismiss={dismiss} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
