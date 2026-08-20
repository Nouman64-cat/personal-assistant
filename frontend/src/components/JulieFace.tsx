"use client";

import Link from "next/link";
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, X } from "lucide-react";

import { useAppState } from "@/lib/appState";
import { type DisplayMessage, useChatState } from "@/lib/chatState";
import { useVoiceState } from "@/lib/voiceState";
import { cn, formatClockTime } from "@/lib/utils";

import EngagementActionCard from "./EngagementActionCard";
import FreeSlotsCard from "./FreeSlotsCard";
import LookedUpEngagementsCard from "./LookedUpEngagementsCard";

/**
 * There's no error boundary anywhere else in the app, and this widget
 * renders backend-sourced timestamps through date-fns, which throws on an
 * Invalid Date instead of degrading gracefully. Without this boundary, a
 * single malformed timestamp on a free-slot/conflict/engagement turn throws
 * during render, propagates past `VoiceStateProvider` above `JulieFace` in
 * the tree, unmounts it, and its cleanup effect hard-stops Julie's
 * in-progress speech — i.e. a broken side panel would silently cut off the
 * voice reply itself. Keyed by the caller on the message count so a fresh
 * turn always gets a clean boundary instead of staying stuck hidden after
 * one bad turn.
 */
class WidgetErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Julie widget panel failed to render:", error);
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Only these phases count as Julie "getting active" — the wake-word-gated
 * `listening` phase stays a quiet header icon so the takeover doesn't fire
 * every time the mic is merely armed, only for an actual exchange. */
const ACTIVE_STATUSES = new Set(["recording", "processing", "speaking"]);

const FACE_COPY: Record<string, string> = {
  recording: "I'm listening…",
  processing: "Thinking…",
  speaking: "Talking…",
};

const FACE_TONE: Record<string, { bg: string; fill: string; glow: string; ring: string; text: string }> = {
  recording: {
    bg: "from-rose-950 via-zinc-950 to-zinc-950",
    fill: "bg-gradient-to-b from-rose-400 to-rose-600",
    glow: "shadow-[0_0_60px_-8px] shadow-rose-500/70",
    ring: "border-rose-400/60",
    text: "text-rose-300",
  },
  processing: {
    bg: "from-amber-950 via-zinc-950 to-zinc-950",
    fill: "bg-gradient-to-b from-amber-300 to-amber-500",
    glow: "shadow-[0_0_60px_-8px] shadow-amber-500/70",
    ring: "border-amber-400/60",
    text: "text-amber-300",
  },
  speaking: {
    bg: "from-emerald-950 via-zinc-950 to-zinc-950",
    fill: "bg-gradient-to-b from-emerald-300 to-emerald-500",
    glow: "shadow-[0_0_60px_-8px] shadow-emerald-500/70",
    ring: "border-emerald-400/60",
    text: "text-emerald-300",
  },
};

function RobotEye({ status, tone, side }: { status: string; tone: (typeof FACE_TONE)[string]; side: "left" | "right" }) {
  return (
    <div className="relative">
      {/* Eyebrows: tilt inward toward the center — the "paying attention"
          gesture — only while actively recording a command. */}
      {status === "recording" && (
        <span
          className={cn(
            "absolute -top-4 h-1.5 w-8 rounded-full transition-all",
            side === "left" ? "left-0 -rotate-[24deg]" : "right-0 rotate-[24deg]",
            tone.fill,
          )}
        />
      )}
      <div
        className={cn(
          "relative h-20 w-14 overflow-hidden rounded-[1.75rem] border-2 transition-all duration-500 sm:h-28 sm:w-20",
          tone.ring,
          tone.glow,
        )}
      >
        {status === "processing" ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <span
              className={cn(
                "h-3/5 w-3/5 animate-spin rounded-full border-4 border-transparent",
                "border-t-amber-400 border-r-amber-400/40",
              )}
            />
          </span>
        ) : status === "speaking" ? (
          // Squinted, happy arc — a curved band across the lower half of the eye.
          <span
            className={cn(
              "absolute inset-x-0 bottom-0 h-1/2 origin-bottom rounded-t-[3rem] transition-all duration-300",
              tone.fill,
            )}
          />
        ) : (
          <span className={cn("absolute inset-1 animate-eye-blink rounded-[1.4rem]", tone.fill)} />
        )}
      </div>
    </div>
  );
}

function TalkingMouth({ tone }: { tone: (typeof FACE_TONE)[string] }) {
  return (
    <span className="mt-8 flex h-6 items-center gap-1.5" aria-hidden>
      {[0, 1, 2, 3, 4].map((index) => (
        <span
          key={index}
          className={cn("w-2 rounded-full animate-voice-bar", tone.fill)}
          style={{ height: "100%", animationDelay: `${index * 90}ms` }}
        />
      ))}
    </span>
  );
}

/** True once a turn's reply carries something worth putting on screen — a
 * schedule change, a lookup result, free-slot options, or a conflict check —
 * rather than plain conversational prose. */
function hasWidgetContent(message: DisplayMessage | null): message is DisplayMessage {
  if (!message) return false;
  return Boolean(
    (message.actions && message.actions.length > 0) ||
      (message.freeSlots && message.freeSlots.length > 0) ||
      (message.lookedUpEngagements && message.lookedUpEngagements.length > 0) ||
      message.conflict,
  );
}

/** The widget "card" Julie glances toward while she talks through a turn
 * that touched the calendar — the same building blocks the Chat page's
 * message bubbles use, so a scheduled engagement or a free-slot list looks
 * identical whether you asked by voice or by typing. */
function JulieWidgetPanel({ message, shift }: { message: DisplayMessage; shift: ReturnType<typeof useAppState>["shift"] }) {
  const conflict = message.conflict;
  return (
    <div className="animate-widget-slide-in w-[min(92vw,26rem)] max-h-[65vh] space-y-2 overflow-y-auto rounded-2xl bg-white/95 p-4 shadow-2xl ring-1 ring-black/5 backdrop-blur">
      {conflict &&
        (conflict.available ? (
          <div className="flex items-start gap-2 rounded-xl border border-teal-300 bg-teal-50 px-3 py-2.5 text-xs text-teal-900">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Free from {formatClockTime(new Date(conflict.attempted_start_time))} to{" "}
              {formatClockTime(new Date(conflict.attempted_end_time))} — highlighted below.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>&quot;{conflict.attempted_title}&quot;</strong> (
              {formatClockTime(new Date(conflict.attempted_start_time))}–
              {formatClockTime(new Date(conflict.attempted_end_time))}) conflicts with{" "}
              <strong>&quot;{conflict.conflicting_with?.title}&quot;</strong> (
              {conflict.conflicting_with && formatClockTime(new Date(conflict.conflicting_with.start_time))}–
              {conflict.conflicting_with && formatClockTime(new Date(conflict.conflicting_with.end_time))}
              ), highlighted below.
            </span>
          </div>
        ))}
      {message.lookedUpEngagements && message.lookedUpEngagements.length > 0 && (
        <LookedUpEngagementsCard engagements={message.lookedUpEngagements} />
      )}
      {message.freeSlots && message.freeSlots.length > 0 && shift && (
        <FreeSlotsCard
          slots={message.freeSlots}
          busyEngagements={message.busyEngagements ?? []}
          shift={shift}
          highlightRange={
            conflict ? { start: conflict.attempted_start_time, end: conflict.attempted_end_time } : undefined
          }
        />
      )}
      {message.actions && message.actions.length > 0 && (
        <div className="space-y-1.5">
          {message.actions.map((action, index) => (
            <EngagementActionCard key={`${action.engagement.id}-${action.type}-${index}`} action={action} />
          ))}
          <Link
            href="/calendar"
            className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline"
          >
            View on Calendar
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Fullscreen "emo robot" takeover — when Julie moves from passively armed
 * (`listening` for the wake word) into an actual exchange, the whole screen
 * becomes her face: blinking/attentive eyes while she records your command,
 * a thinking spinner while the turn round-trips, and happy squint-eyes with
 * a talking mouth while she speaks the reply. If that reply touched the
 * calendar (a booking, a free-slot list, a lookup, a conflict check), a
 * widget card pops up beside her and she turns her head toward it — the
 * same reply data the Chat page renders inline, surfaced here too so a
 * voice turn isn't just narrated, it's shown. Shares the single voice
 * session from `VoiceStateProvider` — this never owns its own mic.
 */
export default function JulieFace() {
  const voice = useVoiceState();
  const { messages } = useChatState();
  const { shift } = useAppState();
  const [dismissed, setDismissed] = useState(false);

  // A fresh command recording is a new "activation" worth resurfacing even
  // if the user dismissed the overlay on a previous turn in this session.
  // Adjusted during render (React's pattern for resetting state off a
  // derived value change) rather than in an effect, to avoid an extra pass.
  const [prevStatus, setPrevStatus] = useState(voice.status);
  if (voice.status !== prevStatus) {
    setPrevStatus(voice.status);
    if (voice.status === "recording" && dismissed) setDismissed(false);
  }

  const wasActiveRef = useRef(false);
  const isActive = voice.enabled && ACTIVE_STATUSES.has(voice.status) && !dismissed;
  // Keeps the overlay mounted through its own fade-out transition instead of
  // disappearing the instant `isActive` flips false.
  const [mounted, setMounted] = useState(isActive);
  useEffect(() => {
    if (isActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      wasActiveRef.current = true;
    } else if (wasActiveRef.current) {
      const timer = setTimeout(() => setMounted(false), 400);
      return () => clearTimeout(timer);
    }
  }, [isActive]);

  const latestAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i];
    }
    return null;
  }, [messages]);

  // Only surface the widget once Julie is actually speaking the reply it
  // belongs to — `messages` updates the instant the turn resolves, before
  // she starts talking, so gating on `speaking` keeps a stale card from
  // flashing up while the next command is still being recorded.
  const widgetMessage = voice.status === "speaking" && hasWidgetContent(latestAssistantMessage)
    ? latestAssistantMessage
    : null;

  if (!mounted) return null;

  const tone = FACE_TONE[voice.status] ?? FACE_TONE.recording;
  const caption = voice.status === "speaking" ? voice.lastSpoken : voice.lastHeard;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[999] flex flex-col items-center justify-center bg-gradient-to-b transition-opacity duration-400 ease-out",
        isActive ? "opacity-100" : "pointer-events-none opacity-0",
        tone.bg,
      )}
      role="status"
      aria-live="polite"
      aria-hidden={!isActive}
    >
      <button
        type="button"
        onClick={(event) => {
          // Dismissing marks the overlay aria-hidden in this same render —
          // move focus off the button first so the browser never has to
          // hide a focused descendant from assistive tech.
          event.currentTarget.blur();
          setDismissed(true);
        }}
        aria-label="Dismiss Julie"
        className="absolute right-5 top-5 rounded-full p-2 text-white/50 transition hover:bg-white/10 hover:text-white/90"
      >
        <X className="h-5 w-5" />
      </button>

      <div
        className={cn(
          "flex w-full flex-col items-center justify-center gap-10 px-6",
          widgetMessage && "sm:flex-row sm:gap-16",
        )}
      >
        <div className="flex flex-col items-center">
          {/* Static head-turn toward the widget card — kept on its own
              wrapper so it composes with, instead of fighting, the child's
              animated float/tilt transform (two classes on one element that
              both set `transform` would just have the later one win). */}
          <div className={cn("transition-transform duration-500", widgetMessage && "sm:rotate-6")}>
            <div
              className={cn(
                "flex flex-col items-center",
                voice.status === "processing" ? "animate-head-tilt" : "animate-eye-float",
              )}
            >
              <div className="flex items-center gap-6 sm:gap-10">
                <RobotEye status={voice.status} tone={tone} side="left" />
                <RobotEye status={voice.status} tone={tone} side="right" />
              </div>
              {voice.status === "speaking" && <TalkingMouth tone={tone} />}
            </div>
          </div>

          <p className={cn("mt-10 text-sm font-medium uppercase tracking-[0.2em]", tone.text)}>
            {FACE_COPY[voice.status]}
          </p>

          {caption && (
            <p className="animate-voice-pop-in mt-4 max-w-md px-8 text-center text-lg text-white/90">
              {voice.status === "speaking" ? caption : `"${caption}"`}
            </p>
          )}
        </div>

        {widgetMessage && (
          <WidgetErrorBoundary key={messages.length}>
            <JulieWidgetPanel message={widgetMessage} shift={shift} />
          </WidgetErrorBoundary>
        )}
      </div>
    </div>
  );
}
