"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { ApiError, getShiftSettings } from "@/lib/api";
import type { ShiftSettings } from "@/lib/types";

interface AppState {
  shift: ShiftSettings | null;
  shiftLoadError: string | null;
  /** Bumped only when the shift itself is saved, so pages can reset
   * shift-derived state (e.g. FreeSlotViewer's filters) via a `key` remount
   * without also reacting to unrelated data refreshes. */
  shiftVersion: number;
  /** Bumped whenever engagements change, for intra-page sync between
   * siblings (e.g. EngagementList's delete refreshing FreeSlotViewer)
   * without a navigation. Cross-page sync doesn't depend on this — routing
   * to a different page already remounts it with fresh data. */
  refreshSignal: number;
  triggerRefresh: () => void;
  handleShiftSaved: (updated: ShiftSettings) => void;
}

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [shift, setShift] = useState<ShiftSettings | null>(null);
  const [shiftLoadError, setShiftLoadError] = useState<string | null>(null);
  const [shiftVersion, setShiftVersion] = useState(0);
  const [refreshSignal, setRefreshSignal] = useState(0);

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
    <AppStateContext.Provider
      value={{ shift, shiftLoadError, shiftVersion, refreshSignal, triggerRefresh, handleShiftSaved }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error("useAppState must be used within an AppStateProvider");
  }
  return context;
}
