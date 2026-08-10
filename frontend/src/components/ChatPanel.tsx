"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, MessageSquarePlus, Send, Sparkles } from "lucide-react";

import { ApiError, getChatHistory, sendChatMessage } from "@/lib/api";
import { useAppState } from "@/lib/appState";
import type { BusyEngagementInfo, EngagementAction, FreeSlotItem } from "@/lib/types";
import { cn, formatDayLabel } from "@/lib/utils";

import ChatMessageBubble from "./ChatMessageBubble";

const SESSION_STORAGE_KEY = "chat_session_id";

const WEEKDAY_AUTO_SELECT_MS = 4500;
/** Index 0 = Sunday, matching `Date.getDay()`. */
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface WeekdayMatch {
  /** The exact substring matched (e.g. "next monday") — used both for re-detection and as a dismissal key. */
  raw: string;
  weekday: string;
  qualifier: "soonest" | "next";
  start: number;
  end: number;
}

/**
 * Finds the first bare day-of-week mention in the text — one with no explicit
 * date already attached (a weekday immediately followed by a comma is
 * treated as already resolved, so applying a candidate can't re-trigger
 * itself). This is a frontend-only convenience: it lets us hand the model an
 * unambiguous date instead of a bare weekday name, which it's much more
 * reliable at just reading than computing itself. The backend's own
 * deterministic `weekday` resolution (see chat_service.py) remains the
 * safety net for anything that reaches it without going through this picker.
 */
function findWeekdayMention(text: string): WeekdayMatch | null {
  const pattern = /\b(next\s+|this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b(?!\s*,)/i;
  const match = pattern.exec(text);
  if (!match) return null;
  const qualifier: WeekdayMatch["qualifier"] = match[1]?.trim().toLowerCase() === "next" ? "next" : "soonest";
  return {
    raw: match[0],
    weekday: match[2].toLowerCase(),
    qualifier,
    start: match.index,
    end: match.index + match[0].length,
  };
}

/** The next 3 occurrences of `weekday`, counting today itself if today already matches — mirrors the backend's `_resolve_weekday_date`. */
function resolveWeekdayCandidates(weekday: string, qualifier: WeekdayMatch["qualifier"]): Date[] {
  const targetIndex = WEEKDAY_NAMES.indexOf(weekday);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let daysAhead = (targetIndex - today.getDay() + 7) % 7;
  if (qualifier === "next") daysAhead += 7;
  return [0, 7, 14].map((extra) => {
    const date = new Date(today);
    date.setDate(date.getDate() + daysAhead + extra);
    return date;
  });
}

function formatWeekdayReplacement(date: Date): string {
  const weekdayName = date.toLocaleDateString("en-US", { weekday: "long" });
  const monthDay = date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return `${weekdayName}, ${monthDay}`;
}

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  actions?: EngagementAction[];
  freeSlots?: FreeSlotItem[];
  busyEngagements?: BusyEngagementInfo[];
}

export default function ChatPanel() {
  const { shift, triggerRefresh } = useAppState();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const highlightedIndexRef = useRef(highlightedIndex);
  useEffect(() => {
    highlightedIndexRef.current = highlightedIndex;
  }, [highlightedIndex]);
  const [dismissedMatchKey, setDismissedMatchKey] = useState<string | null>(null);

  const weekdayMatch = useMemo(() => findWeekdayMention(input), [input]);
  const matchKey = weekdayMatch ? `${weekdayMatch.start}:${weekdayMatch.raw.toLowerCase()}` : null;
  const isWeekdayPickerOpen = matchKey !== null && matchKey !== dismissedMatchKey;
  const weekdayCandidates = useMemo(
    () => (weekdayMatch ? resolveWeekdayCandidates(weekdayMatch.weekday, weekdayMatch.qualifier) : []),
    [weekdayMatch],
  );

  // A new match (different word or position) always starts back at the soonest candidate.
  // Adjusted during render (React's recommended pattern for resetting state when a derived
  // value changes) rather than in an effect, which would cause an extra render pass.
  const [lastMatchKeyForHighlight, setLastMatchKeyForHighlight] = useState<string | null>(null);
  if (matchKey !== lastMatchKeyForHighlight) {
    setLastMatchKeyForHighlight(matchKey);
    setHighlightedIndex(0);
  }

  function applyWeekdayCandidate(match: WeekdayMatch, index: number) {
    const replacement = formatWeekdayReplacement(weekdayCandidates[index] ?? resolveWeekdayCandidates(match.weekday, match.qualifier)[index]);
    const current = inputRef.current;
    // Guard against the match having shifted (e.g. an edit elsewhere) since this candidate list was built.
    if (current.slice(match.start, match.end) !== match.raw) return;
    const caret = match.start + replacement.length;
    setInput(current.slice(0, match.start) + replacement + current.slice(match.end));
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }

  // Auto-select the soonest (or currently highlighted) candidate if the user doesn't interact —
  // tied to the match's identity (word + position), not every keystroke, so editing elsewhere in
  // the message doesn't reset the clock.
  useEffect(() => {
    if (!isWeekdayPickerOpen || !weekdayMatch) return;
    const match = weekdayMatch;
    const timer = setTimeout(() => {
      applyWeekdayCandidate(match, highlightedIndexRef.current);
    }, WEEKDAY_AUTO_SELECT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchKey, isWeekdayPickerOpen]);

  const detectedTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  }, []);
  const timezone = shift?.timezone ?? detectedTimezone;

  useEffect(() => {
    const storedSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!storedSessionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsHydrating(false);
      return;
    }

    let cancelled = false;
    getChatHistory(storedSessionId)
      .then((history) => {
        if (cancelled) return;
        setSessionId(history.session_id);
        setMessages(
          history.messages.map((message) => ({
            role: message.role,
            content: message.content,
            actions: message.actions,
            freeSlots: message.free_slots,
            busyEngagements: message.busy_engagements,
          })),
        );
      })
      .catch((caught) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 404) {
          window.localStorage.removeItem(SESSION_STORAGE_KEY);
        } else {
          setError(caught instanceof ApiError ? caught.message : "Failed to load conversation history.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    setMessages((previous) => [...previous, { role: "user", content: trimmed }]);
    setInput("");
    setIsSending(true);
    setError(null);

    try {
      const response = await sendChatMessage({
        session_id: sessionId,
        message: trimmed,
        timezone,
      });
      if (response.session_id !== sessionId) {
        setSessionId(response.session_id);
        window.localStorage.setItem(SESSION_STORAGE_KEY, response.session_id);
      }
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: response.reply,
          actions: response.actions,
          freeSlots: response.free_slots,
          busyEngagements: response.busy_engagements,
        },
      ]);
      if (response.actions.length > 0) triggerRefresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong sending that message.");
    } finally {
      setIsSending(false);
    }
  }

  function handleNewChat() {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setSessionId(null);
    setMessages([]);
    setError(null);
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Chat</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Tell it what to schedule, move, or cancel — it remembers this conversation.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleNewChat}
          disabled={messages.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          New Chat
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {isHydrating ? (
          <div className="flex items-center justify-center py-8 text-zinc-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            <Sparkles className="h-6 w-6 text-violet-400" />
            <p>
              Try &quot;Schedule a call with Sam tomorrow at 3pm&quot; or &quot;What&apos;s free
              this week?&quot;
            </p>
          </div>
        ) : (
          messages.map((message, index) => (
            <ChatMessageBubble
              key={index}
              role={message.role}
              content={message.content}
              actions={message.actions}
              freeSlots={message.freeSlots}
              busyEngagements={message.busyEngagements}
              shift={shift}
            />
          ))
        )}
        {isSending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking…
            </div>
          </div>
        )}
        <div ref={scrollAnchorRef} />
      </div>

      {error && (
        <div className="mx-5 mb-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="relative flex items-end gap-2 border-t border-zinc-200 p-4 dark:border-zinc-800">
        {isWeekdayPickerOpen && weekdayMatch && (
          <div className="absolute bottom-full left-4 z-10 mb-2 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Which {weekdayMatch.weekday.charAt(0).toUpperCase() + weekdayMatch.weekday.slice(1)}?
            </div>
            <ul>
              {weekdayCandidates.map((date, index) => {
                const isToday = index === 0 && date.toDateString() === new Date().toDateString();
                return (
                  <li key={index}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onClick={() => applyWeekdayCandidate(weekdayMatch, index)}
                      className={cn(
                        "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition",
                        index === highlightedIndex
                          ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                          : "text-zinc-700 dark:text-zinc-200",
                      )}
                    >
                      <span>{formatDayLabel(date)}</span>
                      {isToday && <span className="text-xs text-zinc-400">today</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-zinc-100 px-3 py-1.5 text-[10px] text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
              ↑↓ choose · Enter confirm · Esc skip
            </div>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (isWeekdayPickerOpen && weekdayMatch) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlightedIndex((i) => Math.min(i + 1, weekdayCandidates.length - 1));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlightedIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                applyWeekdayCandidate(weekdayMatch, highlightedIndex);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setDismissedMatchKey(matchKey);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          placeholder="Message the assistant…"
          rows={1}
          disabled={isSending}
          className="max-h-32 flex-1 resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={isSending || input.trim().length === 0}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send message"
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </section>
  );
}
