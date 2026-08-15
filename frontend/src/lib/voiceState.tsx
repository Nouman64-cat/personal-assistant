"use client";

import { createContext, useContext } from "react";

import { useWakeWordVoice, type UseWakeWordVoiceResult } from "@/hooks/useWakeWordVoice";
import { useChatState } from "@/lib/chatState";

const VoiceStateContext = createContext<UseWakeWordVoiceResult | null>(null);

/**
 * Hosts the single `useWakeWordVoice` instance for the whole app. The hook
 * owns a live mic stream and a long-running SpeechRecognition loop, so it
 * must only ever be instantiated once — this provider is what lets both the
 * header's `JulieControl` button and the fullscreen `JulieFace` overlay
 * react to the same listening/recording/speaking state instead of each
 * spinning up its own (conflicting) mic session.
 */
export function VoiceStateProvider({ children }: { children: React.ReactNode }) {
  const { sendTurn } = useChatState();
  const voice = useWakeWordVoice({ onCommand: sendTurn });

  return <VoiceStateContext.Provider value={voice}>{children}</VoiceStateContext.Provider>;
}

export function useVoiceState(): UseWakeWordVoiceResult {
  const context = useContext(VoiceStateContext);
  if (!context) {
    throw new Error("useVoiceState must be used within a VoiceStateProvider");
  }
  return context;
}
