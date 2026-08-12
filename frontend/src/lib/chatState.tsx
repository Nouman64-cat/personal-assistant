"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { ApiError, getChatHistory, sendChatMessage } from "@/lib/api";
import { useAppState } from "@/lib/appState";
import type { BusyEngagementInfo, ConflictInfo, EngagementAction, FreeSlotItem, LookedUpEngagement } from "@/lib/types";
import { buildSpokenReply } from "@/lib/voicePhrasing";

const SESSION_STORAGE_KEY = "chat_session_id";

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  actions?: EngagementAction[];
  freeSlots?: FreeSlotItem[];
  busyEngagements?: BusyEngagementInfo[];
  conflict?: ConflictInfo | null;
  lookedUpEngagements?: LookedUpEngagement[];
}

interface ChatState {
  messages: DisplayMessage[];
  isSending: boolean;
  isHydrating: boolean;
  error: string | null;
  /** Runs one full chat turn against the persisted session and resolves
   * with a short spoken-friendly line (see buildSpokenReply) — shared by
   * the Chat page's textarea and the global "Bella" voice control, so
   * either one can drive the same conversation from any page. */
  sendTurn: (text: string) => Promise<string>;
  handleNewChat: () => void;
}

const ChatStateContext = createContext<ChatState | null>(null);

export function ChatStateProvider({ children }: { children: React.ReactNode }) {
  const { shift, triggerRefresh } = useAppState();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            lookedUpEngagements: message.looked_up_engagements,
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

  async function sendTurn(trimmed: string): Promise<string> {
    setMessages((previous) => [...previous, { role: "user", content: trimmed }]);
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
          conflict: response.conflict,
          lookedUpEngagements: response.looked_up_engagements,
        },
      ]);
      if (response.actions.length > 0) triggerRefresh();
      return buildSpokenReply(response);
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : "Something went wrong sending that message.";
      setError(message);
      throw new Error(message);
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
    <ChatStateContext.Provider value={{ messages, isSending, isHydrating, error, sendTurn, handleNewChat }}>
      {children}
    </ChatStateContext.Provider>
  );
}

export function useChatState(): ChatState {
  const context = useContext(ChatStateContext);
  if (!context) {
    throw new Error("useChatState must be used within a ChatStateProvider");
  }
  return context;
}
