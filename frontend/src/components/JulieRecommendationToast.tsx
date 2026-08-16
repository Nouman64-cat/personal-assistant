"use client";

import { useEffect, useRef, useState } from "react";
import { Droplets, Lightbulb, X } from "lucide-react";

import type { RecommendationKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { speakJulie, type SpeakHandle } from "@/lib/julieSpeak";

export interface RecommendationToastData {
  id: string;
  kind: RecommendationKind;
  text: string;
}

interface JulieRecommendationToastProps {
  data: RecommendationToastData;
  onDismiss: () => void;
}

/** How long the toast lingers after Julie finishes speaking before it closes itself. */
const AUTO_DISMISS_MS = 10_000;

const KIND_ACCENT: Record<RecommendationKind, string> = {
  wellness: "from-sky-500 to-sky-600",
  growth: "from-amber-500 to-amber-600",
};

const KIND_GLOW: Record<RecommendationKind, string> = {
  wellness: "shadow-sky-500/30",
  growth: "shadow-amber-500/30",
};

const KIND_LABEL: Record<RecommendationKind, string> = {
  wellness: "A quick check-in",
  growth: "Something to grow on",
};

export function JulieRecommendationToast({ data, onDismiss }: JulieRecommendationToastProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const speakHandleRef = useRef<SpeakHandle | null>(null);
  const dismissedRef = useRef(false);

  // Entrance animation
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, []);

  // Speaks once, then auto-closes a while after Julie finishes — unlike the
  // engagement alarm this is a suggestion, not something to keep ringing
  // until acknowledged.
  useEffect(() => {
    let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

    async function run() {
      const handle = speakJulie(data.text);
      speakHandleRef.current = handle;
      setSpeaking(true);
      await handle.done;
      setSpeaking(false);
      if (dismissedRef.current) return;
      autoDismissTimer = setTimeout(dismiss, AUTO_DISMISS_MS);
    }

    void run();

    return () => {
      dismissedRef.current = true;
      speakHandleRef.current?.cancel();
      if (autoDismissTimer) clearTimeout(autoDismissTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    dismissedRef.current = true;
    speakHandleRef.current?.cancel();
    setExiting(true);
    setTimeout(onDismiss, 420);
  }

  const accent = KIND_ACCENT[data.kind];
  const glow = KIND_GLOW[data.kind];
  const Icon = data.kind === "wellness" ? Droplets : Lightbulb;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "relative w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border bg-white shadow-2xl dark:bg-zinc-900",
        glow,
        "border-zinc-200 dark:border-zinc-700",
        "transition-all duration-[420ms] ease-out",
        visible && !exiting
          ? "translate-y-0 opacity-100 scale-100"
          : "translate-y-4 opacity-0 scale-95",
      )}
    >
      {/* Top gradient accent bar */}
      <div className={cn("h-1.5 w-full bg-gradient-to-r", accent)} />

      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              <div
                className={cn(
                  "absolute -inset-2 rounded-full bg-gradient-to-br opacity-25 blur-md",
                  accent,
                  speaking && "animate-pulse",
                )}
              />
              <div
                className={cn(
                  "relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br shadow-lg",
                  accent,
                )}
              >
                <Icon className="h-5 w-5 text-white" />
              </div>
            </div>

            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                {KIND_LABEL[data.kind]}
              </p>
              {speaking && (
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
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
            aria-label="Dismiss suggestion"
            className="flex-shrink-0 rounded-xl p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">{data.text}</p>
      </div>
    </div>
  );
}
