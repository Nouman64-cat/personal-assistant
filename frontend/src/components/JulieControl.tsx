"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Mic, MicOff, X } from "lucide-react";

import { useWakeWordVoice, type VoiceStatus } from "@/hooks/useWakeWordVoice";
import { useChatState } from "@/lib/chatState";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: 'Say "Julie" to wake her',
  listening: 'Listening for "Julie"…',
  recording: "I'm listening…",
  processing: "One moment…",
  speaking: "Speaking…",
};

/** Ring/glow tokens per status — violet while just listening for the wake
 * word, rose while actively recording a command, amber while thinking,
 * emerald while speaking back. Keeps the control legible as a live status
 * indicator at a glance, not just an on/off toggle. */
const STATUS_TONE: Record<VoiceStatus, { ring: string; glow: string; dot: string }> = {
  idle: { ring: "", glow: "", dot: "" },
  listening: { ring: "ring-violet-400/70", glow: "shadow-[0_0_18px_-2px] shadow-violet-500/50", dot: "bg-violet-500" },
  recording: { ring: "ring-rose-400/70", glow: "shadow-[0_0_18px_-2px] shadow-rose-500/50", dot: "bg-rose-500" },
  processing: { ring: "ring-amber-400/70", glow: "shadow-[0_0_18px_-2px] shadow-amber-500/50", dot: "bg-amber-500" },
  speaking: { ring: "ring-emerald-400/70", glow: "shadow-[0_0_18px_-2px] shadow-emerald-500/50", dot: "bg-emerald-500" },
};

function EqualizerBars({ tone }: { tone: "rose" | "emerald" | "white" }) {
  const color = tone === "rose" ? "bg-rose-500" : tone === "emerald" ? "bg-emerald-500" : "bg-white";
  return (
    <span className="flex h-3 items-center gap-[3px]" aria-hidden>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn("w-[3px] rounded-full animate-voice-bar", color)}
          style={{ height: "100%", animationDelay: `${index * 140}ms` }}
        />
      ))}
    </span>
  );
}

export default function JulieControl() {
  const { sendTurn } = useChatState();
  const voice = useWakeWordVoice({ onCommand: sendTurn });
  const [captionVisible, setCaptionVisible] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);

  useEffect(() => {
    if (!voice.lastHeard && !voice.lastSpoken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCaptionVisible(false);
      return;
    }
    setCaptionVisible(true);
    const timer = setTimeout(() => setCaptionVisible(false), 8000);
    return () => clearTimeout(timer);
  }, [voice.lastHeard, voice.lastSpoken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (voice.error) setErrorDismissed(false);
  }, [voice.error]);

  const tone = STATUS_TONE[voice.status];
  const isActivelyOn = voice.enabled && (voice.status === "recording" || voice.status === "speaking");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={voice.toggle}
        disabled={!voice.supported}
        aria-pressed={voice.enabled}
        title={
          !voice.supported
            ? "Voice isn't supported in this browser — try Chrome or Edge"
            : voice.enabled
              ? 'Turn off the "Julie" voice assistant'
              : 'Turn on the "Julie" voice assistant'
        }
        className={cn(
          "group relative flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40",
          voice.enabled
            ? "bg-white shadow-md ring-1 ring-inset dark:bg-zinc-800"
            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
          voice.enabled && tone.ring,
        )}
      >
        <span
          className={cn(
            "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all",
            voice.enabled
              ? cn("bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white", tone.glow)
              : "bg-zinc-300 text-zinc-600 dark:bg-zinc-600 dark:text-zinc-300",
          )}
        >
          {/* Radar pings while actively listening for the wake word — the
              control's "I'm on and paying attention" heartbeat. */}
          {voice.status === "listening" && (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-violet-400 opacity-40" />
              <span
                className="absolute -inset-1.5 animate-ping rounded-full bg-violet-400 opacity-20"
                style={{ animationDelay: "0.4s" }}
              />
            </>
          )}
          {voice.status === "processing" ? (
            <Loader2 className="relative h-3.5 w-3.5 animate-spin" />
          ) : voice.status === "recording" ? (
            <span className="relative">
              <EqualizerBars tone="white" />
            </span>
          ) : voice.status === "speaking" ? (
            <span className="relative">
              <EqualizerBars tone="white" />
            </span>
          ) : voice.enabled ? (
            <Mic className="relative h-3.5 w-3.5" />
          ) : (
            <MicOff className="relative h-3.5 w-3.5" />
          )}
        </span>

        <span className="flex flex-col items-start leading-none">
          <span className={cn("text-xs font-semibold", voice.enabled ? "text-zinc-900 dark:text-zinc-50" : "")}>
            Julie
          </span>
          <span
            className={cn(
              "mt-0.5 hidden text-[10px] font-medium sm:block",
              voice.enabled ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-400 dark:text-zinc-500",
            )}
          >
            {voice.enabled ? STATUS_LABEL[voice.status] : "Off"}
          </span>
        </span>

        {isActivelyOn && (
          <span
            className={cn(
              "absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-900",
              tone.dot,
            )}
          />
        )}
      </button>

      {/* Live caption — what Julie just heard and replied, so a voice turn
          from any page gives visible confirmation without needing the Chat
          page open. Auto-dismisses a few seconds after the exchange ends. */}
      {captionVisible && (voice.lastHeard || voice.lastSpoken) && (
        <div className="animate-voice-pop-in absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-100 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/5 to-transparent px-3 py-2 dark:border-zinc-700">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
              Julie
            </span>
            <button
              type="button"
              onClick={() => setCaptionVisible(false)}
              className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-700"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-1.5 px-3 py-2.5 text-xs">
            {voice.lastHeard && (
              <p className="text-zinc-500 dark:text-zinc-400">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">You said </span>
                &ldquo;{voice.lastHeard}&rdquo;
              </p>
            )}
            {voice.lastSpoken && <p className="text-zinc-800 dark:text-zinc-100">{voice.lastSpoken}</p>}
          </div>
        </div>
      )}

      {voice.error && !errorDismissed && (
        <div className="animate-voice-pop-in absolute right-0 top-full z-50 mt-2 flex w-72 items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 shadow-lg dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{voice.error}</span>
          <button
            type="button"
            onClick={() => setErrorDismissed(true)}
            className="rounded p-0.5 text-amber-500 transition hover:bg-amber-100 dark:hover:bg-amber-900/40"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
