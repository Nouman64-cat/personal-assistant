"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { openSpeechStream, transcribeVoice } from "@/lib/api";

const WAKE_WORD_PATTERN = /\bjulie\b/i;
/** How long the mic has to stay quiet before a command recording is considered finished. Kept snappy — long pauses here are the main thing that makes a voice assistant feel laggy. */
const SILENCE_MS = 900;
/** Silence is only evaluated once at least this much time has passed and the user has spoken at least once — avoids stopping on the initial dead air before they start talking. */
const MIN_RECORD_BEFORE_SILENCE_CHECK_MS = 400;
/** Hard cap so a stuck silence detector (e.g. constant background noise) can't record forever. */
const MAX_RECORD_MS = 20_000;
/** RMS (0..1) above which a video frame counts as "someone is talking", not ambient noise. */
const VOICE_RMS_THRESHOLD = 0.02;
/**
 * After finishing a reply, Julie stays actively listening for a follow-up
 * command — no need to repeat the wake word — for this long. If nobody's
 * said anything by the time this elapses, that counts as "long inactivity"
 * and she drops back to wake-word-gated listening to save the round trip.
 * Kept generous — this window closing silently is what makes a multi-turn
 * conversation feel like it randomly stopped working.
 */
const FOLLOWUP_NO_SPEECH_TIMEOUT_MS = 20_000;
/** RMS (0..1) above which mic input during playback counts as the user talking over Julie, not echo bleeding back through the speaker. Set above VOICE_RMS_THRESHOLD since an un-cancelled sliver of her own voice is louder than typical background noise. */
const BARGE_IN_RMS_THRESHOLD = 0.035;
/** Consecutive loud analyser frames required before treating mic input during playback as a real interruption rather than a stray click or echo pop. */
const BARGE_IN_CONSECUTIVE_FRAMES = 4;

/** Warm, energetic openers spoken the moment the wake word fires — picked at random so it doesn't feel like a canned response every time. */
const WAKE_GREETINGS = [
  "Hey! Great to hear from you — what can I help you with?",
  "Hey there! Hope you're having a great day. Want to check your schedule, or add something new?",
  "Hi! I'm all ears — what's up?",
  "Hey! It's a great day to get things done. What are we working on?",
  "Hello! Ready when you are — what can I do for you?",
];

function pickWakeGreeting(): string {
  return WAKE_GREETINGS[Math.floor(Math.random() * WAKE_GREETINGS.length)];
}

export type VoiceStatus = "idle" | "listening" | "recording" | "processing" | "speaking";

interface UseWakeWordVoiceOptions {
  /** Runs the transcribed command through the normal chat turn; resolves with the reply text to speak back. */
  onCommand: (text: string) => Promise<string>;
}

export interface UseWakeWordVoiceResult {
  /** False when the browser has neither SpeechRecognition nor MediaRecorder — Chrome/Edge only. */
  supported: boolean;
  enabled: boolean;
  status: VoiceStatus;
  error: string | null;
  toggle: () => void;
  /** What Julie heard on the most recent command — for a live-caption UI. Cleared at the start of the next recording. */
  lastHeard: string | null;
  /** The short spoken line Julie replied with on the most recent turn — for a live-caption UI. Cleared at the start of the next recording. */
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

async function playBlob(blob: Blob, onAudioElement: (audio: HTMLAudioElement | null) => void): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  onAudioElement(audio);
  await new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
  onAudioElement(null);
  URL.revokeObjectURL(url);
}

/**
 * Plays a streamed mp3 `Response` as it downloads, via MediaSource Extensions
 * — audio starts as soon as the first chunk is buffered instead of waiting
 * for the whole clip, which was the single biggest source of "the reply
 * feels slow to start talking". Falls back to buffer-then-play if the
 * browser lacks MSE mp3 support. `isAborted` is polled between chunks so a
 * mid-stream "Julie" toggle-off stops playback promptly.
 */
async function playAudioResponse(
  response: Response,
  isAborted: () => boolean,
  onAudioElement: (audio: HTMLAudioElement | null) => void,
): Promise<void> {
  const canStream =
    typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg") && response.body !== null;

  if (!canStream) {
    const blob = await response.blob();
    if (isAborted()) return;
    await playBlob(blob, onAudioElement);
    return;
  }

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  const audio = new Audio(objectUrl);
  onAudioElement(audio);
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
    onAudioElement(null);
    URL.revokeObjectURL(objectUrl);
    return;
  }

  await donePromise;
  onAudioElement(null);
  URL.revokeObjectURL(objectUrl);
}

/**
 * Always-on "Julie" wake-word listener for hands-free engagement CRUD.
 *
 * Three-phase loop, all phases driven off the same mic permission grant:
 * 1. A continuous browser SpeechRecognition session listens only for the
 *    wake word (free, local to the browser — no audio leaves the machine
 *    until the wake word fires).
 * 2. Once heard, it stops the recognizer, speaks a short friendly greeting
 *    (see WAKE_GREETINGS), then switches to a MediaRecorder capture of the
 *    actual command, auto-stopped by a lightweight RMS-based silence
 *    detector. That clip is the only audio sent to OpenAI, transcribed via
 *    the cheap gpt-4o-mini-transcribe model.
 * 3. After speaking the reply, instead of dropping straight back to
 *    wake-word-gated listening, it opens a follow-up recording window
 *    (see FOLLOWUP_NO_SPEECH_TIMEOUT_MS, with a short chime marking when it
 *    opens) so a conversation with several back-to-back commands doesn't
 *    need "Julie" repeated every time. Only once that window passes with no
 *    speech does it fall back to phase 1. This window opens after *any*
 *    turn, including a failed one — a transient transcription/network error
 *    shouldn't force the user to say the wake word again.
 * 4. While a reply is being spoken (phase 2/3's TTS playback), the warm mic
 *    stream is also monitored for barge-in: if the user starts talking over
 *    Julie, playback is cut and a command recording starts immediately,
 *    same as phase 2's post-greeting recording. Relies on the browser's
 *    default echo cancellation to keep Julie's own voice from
 *    self-triggering this (see BARGE_IN_RMS_THRESHOLD).
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
  // Set right before stopping a follow-up recording that never heard any
  // speech, so mediaRecorder.onstop knows to discard the (silent) clip and
  // drop back to wake-word listening instead of sending it off to be
  // transcribed.
  const abandonRecordingRef = useRef(false);
  // The `<audio>` element currently playing a reply, if any — kept as a ref
  // (not state) so the barge-in monitor's animation-frame loop can pause it
  // synchronously the instant it hears the user start talking.
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  // Flipped by the barge-in monitor when it detects the user talking over a
  // reply; checked by playAudioResponse's isAborted() poll and by speak()'s
  // caller to skip straight into a new command recording instead of the
  // normal followup window.
  const interruptedRef = useRef(false);
  const bargeInAudioContextRef = useRef<AudioContext | null>(null);
  const bargeInRafRef = useRef<number | null>(null);

  // Tears down the per-recording-cycle machinery (analyser loop, timers,
  // the MediaRecorder itself) but deliberately leaves the mic stream open —
  // it's kept warm for the whole "enabled" session (see `prepareMicStream`)
  // so each new command recording can start instantly instead of paying a
  // fresh getUserMedia device-negotiation delay every time "Julie" fires.
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
    stopBargeInMonitor();
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }

  function stopBargeInMonitor() {
    if (bargeInRafRef.current !== null) {
      cancelAnimationFrame(bargeInRafRef.current);
      bargeInRafRef.current = null;
    }
    void bargeInAudioContextRef.current?.close().catch(() => {});
    bargeInAudioContextRef.current = null;
  }

  /**
   * Watches the warm mic stream while a reply is playing so the user can
   * talk over Julie instead of waiting her out. Requires a few consecutive
   * loud analyser frames (not just one) before treating it as a real
   * interruption — a single frame is too easy to trip on a click/pop or a
   * bit of Julie's own voice slipping past the browser's echo cancellation.
   * No-ops (playback just runs to completion) if there's no warm stream yet
   * or the browser lacks AudioContext.
   */
  function startBargeInMonitor() {
    const stream = streamRef.current;
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!stream || !AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    bargeInAudioContextRef.current = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    let consecutiveLoudFrames = 0;

    const monitor = () => {
      if (interruptedRef.current || stoppedRef.current) return;
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      consecutiveLoudFrames = rms > BARGE_IN_RMS_THRESHOLD ? consecutiveLoudFrames + 1 : 0;
      if (consecutiveLoudFrames >= BARGE_IN_CONSECUTIVE_FRAMES) {
        interruptedRef.current = true;
        currentAudioRef.current?.pause();
        return;
      }
      bargeInRafRef.current = requestAnimationFrame(monitor);
    };
    bargeInRafRef.current = requestAnimationFrame(monitor);
  }

  /** Short two-decay tone marking the moment the post-reply follow-up window opens, so "still listening" is audible instead of a guess. */
  function playListeningChime() {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.2);
    oscillator.onended = () => void ctx.close();
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
        setError("Microphone access was denied — allow it in the browser's site settings to use Julie.");
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
        void greetThenRecord();
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

  /**
   * Speaks a short, friendly greeting the moment the wake word fires, then
   * starts recording the actual command — the "hey, what's up?" beat that
   * makes waking Julie feel like greeting a person instead of just arming a
   * recorder.
   */
  async function greetThenRecord() {
    if (stoppedRef.current) return;
    const greeting = pickWakeGreeting();
    setLastHeard(null);
    setLastSpoken(greeting);
    await speak(greeting);
    if (stoppedRef.current) return;
    await beginRecording("wake");
  }

  /**
   * `mode: "wake"` is a command recorded right after the wake word/greeting
   * — the user just asked for this, so it's worth waiting the full
   * MAX_RECORD_MS for them to start talking. `mode: "followup"` is the
   * post-reply "still listening" window opened without the wake word —
   * since nobody explicitly asked for this one, it gives up sooner
   * (FOLLOWUP_NO_SPEECH_TIMEOUT_MS) if nothing is said, discarding the
   * silent clip and falling back to wake-word-gated listening rather than
   * paying a transcription round trip on dead air. It's also reused as the
   * landing spot for a barge-in interruption (the user was already talking
   * when it started, so it picks their speech up immediately rather than
   * waiting out the timeout, and skips the chime below since they're
   * already mid-sentence) — otherwise announced with a short chime, since
   * nothing else tells the user this window is open.
   */
  async function beginRecording(mode: "wake" | "followup") {
    if (stoppedRef.current) return;
    if (mode === "followup" && !interruptedRef.current) playListeningChime();
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
          if (mode === "followup" && !hasSpoken && now - startedAt > FOLLOWUP_NO_SPEECH_TIMEOUT_MS) {
            abandonRecordingRef.current = true;
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
        cleanupRecordingArtifacts();
        if (abandonRecordingRef.current) {
          abandonRecordingRef.current = false;
          chunksRef.current = [];
          if (!stoppedRef.current) startListening();
          return;
        }
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
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
      // Open the follow-up window after *any* turn, success or failure — a
      // transient transcription/network hiccup shouldn't force the user to
      // repeat the wake word. It degrades gracefully on its own
      // (FOLLOWUP_NO_SPEECH_TIMEOUT_MS) if nothing more is said.
      if (!stoppedRef.current) void beginRecording("followup");
    }
  }

  async function speak(spokenText: string) {
    if (stoppedRef.current) return;
    setStatus("speaking");
    interruptedRef.current = false;
    startBargeInMonitor();
    try {
      // `spokenText` is already the short natural line built by
      // buildSpokenReply — this call just turns it into audio.
      const response = await openSpeechStream(spokenText);
      if (stoppedRef.current) return;
      await playAudioResponse(
        response,
        () => stoppedRef.current || interruptedRef.current,
        (audio) => {
          currentAudioRef.current = audio;
        },
      );
    } catch {
      // TTS request failed — the reply is still visible in the chat log, so just fall back to silence.
    } finally {
      stopBargeInMonitor();
      currentAudioRef.current = null;
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
