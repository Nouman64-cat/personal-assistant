"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { openSpeechStream, transcribeVoice } from "@/lib/api";

const WAKE_WORD_PATTERN = /\bbella\b/i;
/** How long the mic has to stay quiet before a command recording is considered finished. Kept snappy — long pauses here are the main thing that makes a voice assistant feel laggy. */
const SILENCE_MS = 900;
/** Silence is only evaluated once at least this much time has passed and the user has spoken at least once — avoids stopping on the initial dead air before they start talking. */
const MIN_RECORD_BEFORE_SILENCE_CHECK_MS = 400;
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
  /** What Bella heard on the most recent command — for a live-caption UI. Cleared at the start of the next recording. */
  lastHeard: string | null;
  /** The short spoken line Bella replied with on the most recent turn — for a live-caption UI. Cleared at the start of the next recording. */
  lastSpoken: string | null;
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

function appendToSourceBuffer(sourceBuffer: SourceBuffer, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const onUpdateEnd = () => {
      sourceBuffer.removeEventListener("updateend", onUpdateEnd);
      resolve();
    };
    sourceBuffer.addEventListener("updateend", onUpdateEnd);
    try {
      sourceBuffer.appendBuffer(chunk as BufferSource);
    } catch (caught) {
      sourceBuffer.removeEventListener("updateend", onUpdateEnd);
      reject(caught instanceof Error ? caught : new Error("appendBuffer failed"));
    }
  });
}

async function playBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  await new Promise<void>((resolve) => {
    const audio = new Audio(url);
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
  URL.revokeObjectURL(url);
}

/**
 * Plays a streamed mp3 `Response` as it downloads, via MediaSource Extensions
 * — audio starts as soon as the first chunk is buffered instead of waiting
 * for the whole clip, which was the single biggest source of "the reply
 * feels slow to start talking". Falls back to buffer-then-play if the
 * browser lacks MSE mp3 support. `isAborted` is polled between chunks so a
 * mid-stream "Bella" toggle-off stops playback promptly.
 */
async function playAudioResponse(response: Response, isAborted: () => boolean): Promise<void> {
  const canStream =
    typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg") && response.body !== null;

  if (!canStream) {
    const blob = await response.blob();
    if (isAborted()) return;
    await playBlob(blob);
    return;
  }

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  const audio = new Audio(objectUrl);
  const donePromise = new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
  });

  await new Promise<void>((resolve) => {
    mediaSource.addEventListener("sourceopen", () => resolve(), { once: true });
  });
  if (isAborted() || mediaSource.readyState !== "open") {
    URL.revokeObjectURL(objectUrl);
    return;
  }

  const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
  const reader = response.body!.getReader();
  let playbackStarted = false;

  try {
    while (true) {
      if (isAborted()) break;
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        await appendToSourceBuffer(sourceBuffer, value);
        if (!playbackStarted) {
          playbackStarted = true;
          void audio.play().catch(() => {});
        }
      }
    }
  } finally {
    if (mediaSource.readyState === "open") {
      try {
        mediaSource.endOfStream();
      } catch {
        // Already ending/closed from elsewhere — nothing to do.
      }
    }
  }

  if (isAborted()) {
    audio.pause();
    URL.revokeObjectURL(objectUrl);
    return;
  }

  await donePromise;
  URL.revokeObjectURL(objectUrl);
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
 * The transcript is handed off to `onCommand` (the caller's normal
 * chat-send path, so CRUD tool-calling is unchanged) — the caller resolves
 * with a short, natural spoken line built from the turn's structured data
 * (see buildSpokenReply in voicePhrasing.ts) rather than the on-screen
 * `reply` prose, which is then spoken with gpt-4o-mini-tts.
 */
export function useWakeWordVoice({ onCommand }: UseWakeWordVoiceOptions): UseWakeWordVoiceResult {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [lastSpoken, setLastSpoken] = useState<string | null>(null);
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

  // Tears down the per-recording-cycle machinery (analyser loop, timers,
  // the MediaRecorder itself) but deliberately leaves the mic stream open —
  // it's kept warm for the whole "enabled" session (see `prepareMicStream`)
  // so each new command recording can start instantly instead of paying a
  // fresh getUserMedia device-negotiation delay every time "Bella" fires.
  function cleanupRecordingArtifacts() {
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
    mediaRecorderRef.current = null;
  }

  async function prepareMicStream() {
    if (streamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stoppedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
    } catch {
      // Swallow here — beginRecording retries getUserMedia itself and
      // surfaces the error there, since the user may still grant the
      // permission prompt on that later attempt.
    }
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
    cleanupRecordingArtifacts();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
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
          // abort() cuts over immediately; stop() waits to finalize a last
          // result we don't need anyway, adding a needless delay right at
          // the moment responsiveness matters most.
          recognition.abort();
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
    setLastHeard(null);
    setLastSpoken(null);
    try {
      let stream = streamRef.current;
      // Re-acquire if the warm stream never got set up (prepareMicStream
      // failed/raced) or its tracks died (e.g. the mic was unplugged) —
      // the common case just reuses the already-open stream instantly.
      if (!stream || stream.getTracks().some((track) => track.readyState !== "live")) {
        stream?.getTracks().forEach((track) => track.stop());
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stoppedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
      }
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
        cleanupRecordingArtifacts();
        void handleRecordingComplete(blob);
      };
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();

      maxDurationTimerRef.current = setTimeout(stopRecording, MAX_RECORD_MS);
    } catch {
      setError("Couldn't access the microphone for the command.");
      cleanupRecordingArtifacts();
      if (!stoppedRef.current) startListening();
    }
  }

  async function handleRecordingComplete(blob: Blob) {
    if (stoppedRef.current) return;
    setStatus("processing");
    try {
      const text = (await transcribeVoice(blob)).trim();
      if (!text) return;
      setLastHeard(text);
      const reply = await onCommandRef.current(text);
      setLastSpoken(reply);
      await speak(reply);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong with that voice command.");
    } finally {
      if (!stoppedRef.current) startListening();
    }
  }

  async function speak(spokenText: string) {
    if (stoppedRef.current) return;
    setStatus("speaking");
    try {
      // `spokenText` is already the short natural line built by
      // buildSpokenReply — this call just turns it into audio.
      const response = await openSpeechStream(spokenText);
      if (stoppedRef.current) return;
      await playAudioResponse(response, () => stoppedRef.current);
    } catch {
      // TTS request failed — the reply is still visible in the chat log, so just fall back to silence.
    }
  }

  useEffect(() => {
    if (enabled) {
      stoppedRef.current = false;
      void prepareMicStream();
      startListening();
    } else {
      stopAll();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("idle");
      setLastHeard(null);
      setLastSpoken(null);
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

  return { supported, enabled, status, error, toggle, lastHeard, lastSpoken };
}
