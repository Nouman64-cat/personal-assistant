"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { speakText, transcribeVoice } from "@/lib/api";

const WAKE_WORD_PATTERN = /\bbella\b/i;
/** How long the mic has to stay quiet before a command recording is considered finished. */
const SILENCE_MS = 1300;
/** Silence is only evaluated once at least this much time has passed and the user has spoken at least once — avoids stopping on the initial dead air before they start talking. */
const MIN_RECORD_BEFORE_SILENCE_CHECK_MS = 500;
/** Hard cap so a stuck silence detector (e.g. constant background noise) can't record forever. */
const MAX_RECORD_MS = 20_000;
/** RMS (0..1) above which a video frame counts as "someone is talking", not ambient noise. */
const VOICE_RMS_THRESHOLD = 0.02;

export type VoiceStatus = "idle" | "listening" | "recording" | "processing" | "speaking";

interface UseWakeWordVoiceOptions {
  /** Runs the transcribed command through the normal chat turn; resolves with the reply text to speak back. */
  onCommand: (text: string) => Promise<string>;
}

interface UseWakeWordVoiceResult {
  /** False when the browser has neither SpeechRecognition nor MediaRecorder — Chrome/Edge only. */
  supported: boolean;
  enabled: boolean;
  status: VoiceStatus;
  error: string | null;
  toggle: () => void;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((candidate) =>
    MediaRecorder.isTypeSupported(candidate),
  );
}

/**
 * Always-on "Bella" wake-word listener for hands-free engagement CRUD.
 *
 * Two-phase loop, both phases driven off the same mic permission grant:
 * 1. A continuous browser SpeechRecognition session listens only for the
 *    wake word (free, local to the browser — no audio leaves the machine
 *    until the wake word fires).
 * 2. Once heard, it stops the recognizer and switches to a MediaRecorder
 *    capture of the actual command, auto-stopped by a lightweight
 *    RMS-based silence detector. That clip is the only audio sent to
 *    OpenAI, transcribed via the cheap gpt-4o-mini-transcribe model.
 *
 * The transcript is hand off to `onCommand` (the caller's normal chat-send
 * path, so CRUD tool-calling is unchanged) and the reply is spoken back
 * with gpt-4o-mini-tts, prefixed "Lord," for the requested persona.
 */
export function useWakeWordVoice({ onCommand }: UseWakeWordVoiceOptions): UseWakeWordVoiceResult {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Starts false to match the server-rendered markup (no `window` there),
  // then flips true post-mount if the browser actually has these APIs —
  // computing this inline from `window`/`navigator` during render would
  // disagree with SSR and trigger a hydration mismatch.
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(
      getSpeechRecognitionCtor() !== null &&
        typeof navigator !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof MediaRecorder !== "undefined",
    );
  }, []);

  // The listening loop set up by the `enabled` effect below is long-lived —
  // it doesn't restart on every ChatPanel render — so `onCommand` (which
  // closes over session state that changes turn to turn) has to be read
  // through a ref kept current every render, not captured directly.
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  // `stoppedRef` is the source of truth every async continuation checks
  // before touching state — `enabled` alone can't do this since these
  // callbacks run inside promise chains and timer/event callbacks that
  // outlive a single render's closure.
  const stoppedRef = useRef(true);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const pendingActionRef = useRef<"restart" | "record" | "none">("none");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStoppedRef = useRef(true);

  function cleanupRecording() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (maxDurationTimerRef.current !== null) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }

  function stopAll() {
    stoppedRef.current = true;
    pendingActionRef.current = "none";
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Already stopping/stopped — nothing to do.
      }
    }
    cleanupRecording();
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }

  function startListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || stoppedRef.current) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i]?.[0]?.transcript ?? "";
        if (WAKE_WORD_PATTERN.test(transcript)) {
          pendingActionRef.current = "record";
          recognition.stop();
          return;
        }
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access was denied — allow it in the browser's site settings to use Bella.");
        stoppedRef.current = true;
        setEnabled(false);
        setStatus("idle");
      }
      // Other errors (no-speech, aborted, network hiccups) are transient — onend below restarts the loop.
    };
    recognition.onend = () => {
      if (stoppedRef.current) return;
      if (pendingActionRef.current === "record") {
        pendingActionRef.current = "none";
        void beginRecording();
        return;
      }
      // The engine stops on its own after a period of silence even in
      // continuous mode — restart to keep the always-listening loop alive.
      startListening();
    };

    recognitionRef.current = recognition;
    setStatus("listening");
    try {
      recognition.start();
    } catch {
      // Thrown if start() is called on an already-started instance — a stray double-invoke is harmless.
    }
  }

  async function beginRecording() {
    if (stoppedRef.current) return;
    setStatus("recording");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stoppedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      recordingStoppedRef.current = false;

      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        const audioContext = new AudioContextCtor();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const data = new Uint8Array(analyser.fftSize);
        const startedAt = performance.now();
        let lastLoudAt = startedAt;
        let hasSpoken = false;

        const monitor = () => {
          if (recordingStoppedRef.current) return;
          analyser.getByteTimeDomainData(data);
          let sumSquares = 0;
          for (let i = 0; i < data.length; i++) {
            const normalized = (data[i] - 128) / 128;
            sumSquares += normalized * normalized;
          }
          const rms = Math.sqrt(sumSquares / data.length);
          const now = performance.now();
          if (rms > VOICE_RMS_THRESHOLD) {
            lastLoudAt = now;
            hasSpoken = true;
          }
          if (
            hasSpoken &&
            now - startedAt > MIN_RECORD_BEFORE_SILENCE_CHECK_MS &&
            now - lastLoudAt > SILENCE_MS
          ) {
            stopRecording();
            return;
          }
          rafRef.current = requestAnimationFrame(monitor);
        };
        rafRef.current = requestAnimationFrame(monitor);
      }

      const mimeType = pickMimeType();
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        recordingStoppedRef.current = true;
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
        cleanupRecording();
        void handleRecordingComplete(blob);
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();

      maxDurationTimerRef.current = setTimeout(stopRecording, MAX_RECORD_MS);
    } catch {
      setError("Couldn't access the microphone for the command.");
      cleanupRecording();
      if (!stoppedRef.current) startListening();
    }
  }

  async function handleRecordingComplete(blob: Blob) {
    if (stoppedRef.current) return;
    setStatus("processing");
    try {
      const text = (await transcribeVoice(blob)).trim();
      if (!text) return;
      const reply = await onCommandRef.current(text);
      await speak(reply);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong with that voice command.");
    } finally {
      if (!stoppedRef.current) startListening();
    }
  }

  async function speak(replyText: string) {
    if (stoppedRef.current) return;
    setStatus("speaking");
    try {
      const audioBlob = await speakText(`Lord, ${replyText}`);
      if (stoppedRef.current) return;
      const url = URL.createObjectURL(audioBlob);
      await new Promise<void>((resolve) => {
        const audio = new Audio(url);
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
    } catch {
      // TTS request failed — the reply is still visible in the chat log, so just fall back to silence.
    }
  }

  useEffect(() => {
    if (enabled) {
      stoppedRef.current = false;
      startListening();
    } else {
      stopAll();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("idle");
    }
    return () => {
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const toggle = useCallback(() => {
    setError(null);
    setEnabled((previous) => !previous);
  }, []);

  return { supported, enabled, status, error, toggle };
}
