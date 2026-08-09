"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, MessageSquarePlus, Send, Sparkles } from "lucide-react";

import { ApiError, getChatHistory, sendChatMessage } from "@/lib/api";
import { useAppState } from "@/lib/appState";
import type { EngagementAction, FreeSlotItem } from "@/lib/types";

import ChatMessageBubble from "./ChatMessageBubble";

const SESSION_STORAGE_KEY = "chat_session_id";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  actions?: EngagementAction[];
  freeSlots?: FreeSlotItem[];
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

      <div className="flex items-end gap-2 border-t border-zinc-200 p-4 dark:border-zinc-800">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
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
