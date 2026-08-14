"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { listEngagements } from "@/lib/api";
import type { Engagement } from "@/lib/types";
import { parseNaiveIso } from "@/lib/utils";
import { EngagementAlarmToast, type AlarmToastData } from "./EngagementAlarmToast";

/** How many minutes before start to fire the alarm. */
const ALARM_WINDOW_MINUTES = 15;

/** Poll for engagement changes every 60 seconds. */
const POLL_INTERVAL_MS = 60_000;

/** Key in sessionStorage used to avoid re-firing an alarm that was already shown this browser session. */
const FIRED_KEY = "alarm_fired";

interface AlarmContextValue {
  /** Lets other components (e.g. EngagementFormModal) force a re-check after saving a new engagement. */
  recheckAlarms: () => void;
}

const AlarmContext = createContext<AlarmContextValue>({ recheckAlarms: () => {} });

export function useAlarmContext() {
  return useContext(AlarmContext);
}

export function EngagementAlarmProvider({ children }: { children: React.ReactNode }) {
  const [activeAlarms, setActiveAlarms] = useState<AlarmToastData[]>([]);
  const firedRef = useRef<Set<string>>(new Set());

  /**
   * Reads all engagements from the API and fires a toast for any that are
   * starting within the next ALARM_WINDOW_MINUTES minutes and haven't had an
   * alarm fired yet in this session.
   */
  const checkEngagements = useCallback(async () => {
    let engagements: Engagement[];
    try {
      engagements = await listEngagements();
    } catch {
      // Silent — alarm polling should never surface errors to the user.
      return;
    }

    const now = new Date();
    const soon = new Date(now.getTime() + ALARM_WINDOW_MINUTES * 60_000);

    const toFire: AlarmToastData[] = [];

    for (const engagement of engagements) {
      const start = parseNaiveIso(engagement.start_time);

      // Only care about engagements starting in the next 15 min, not already started.
      if (start <= now || start > soon) continue;

      // Build a stable alarm key: ID + the minute bucket (so a 10-min-away alarm
      // doesn't re-fire every time the interval ticks).
      const minutesUntil = Math.round((start.getTime() - now.getTime()) / 60_000);
      const alarmKey = `${engagement.id}-${minutesUntil}`;

      // Check both the in-memory set and sessionStorage (survives fast-refresh).
      const storedFired: string[] = JSON.parse(sessionStorage.getItem(FIRED_KEY) ?? "[]");
      if (firedRef.current.has(alarmKey) || storedFired.includes(alarmKey)) continue;

      firedRef.current.add(alarmKey);
      const updated = [...storedFired, alarmKey];
      sessionStorage.setItem(FIRED_KEY, JSON.stringify(updated));

      toFire.push({ engagement, minutesUntil });
    }

    if (toFire.length > 0) {
      setActiveAlarms((prev) => [...prev, ...toFire]);
    }
  }, []);

  // Initial check + recurring poll
  useEffect(() => {
    void checkEngagements();
    const interval = setInterval(() => void checkEngagements(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkEngagements]);

  function dismissAlarm(engagementId: string) {
    setActiveAlarms((prev) => prev.filter((a) => a.engagement.id !== engagementId));
  }

  return (
    <AlarmContext.Provider value={{ recheckAlarms: checkEngagements }}>
      {children}
      {typeof window !== "undefined" &&
        activeAlarms.length > 0 &&
        createPortal(
          /* ── Top-center fixed overlay ── */
          <div
            aria-label="Engagement alarms"
            className="pointer-events-none fixed inset-x-0 top-6 z-[9999] flex flex-col items-center gap-3 px-4"
          >
            {activeAlarms.map((alarm) => (
              <div key={alarm.engagement.id} className="pointer-events-auto">
                <EngagementAlarmToast alarm={alarm} onDismiss={dismissAlarm} />
              </div>
            ))}
          </div>,
          document.body,
        )}
    </AlarmContext.Provider>
  );
}
