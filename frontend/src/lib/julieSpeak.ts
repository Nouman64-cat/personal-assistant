/**
 * julieSpeak.ts
 *
 * Thin wrapper around the `/api/v1/chat/voice/speak` endpoint that lets any
 * part of the app (not just the Julie voice-control hook) play a TTS line
 * through Julie's voice without duplicating the MediaSource streaming logic.
 *
 * `speakJulie(text)` resolves once playback finishes (or is aborted).
 * Call the returned `cancel()` to stop the audio mid-stream.
 */

import { openSpeechStream } from "@/lib/api";

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

async function playBlob(blob: Blob, isAborted: () => boolean): Promise<void> {
  const url = URL.createObjectURL(blob);
  await new Promise<void>((resolve) => {
    const audio = new Audio(url);
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    void audio.play().catch(() => resolve());
    // Poll abort flag every 100 ms so we can stop mid-blob playback.
    const poll = setInterval(() => {
      if (isAborted()) {
        audio.pause();
        clearInterval(poll);
        resolve();
      }
    }, 100);
    audio.onended = () => { clearInterval(poll); resolve(); };
    audio.onerror = () => { clearInterval(poll); resolve(); };
  });
  URL.revokeObjectURL(url);
}

async function playAudioResponse(response: Response, isAborted: () => boolean): Promise<void> {
  const canStream =
    typeof MediaSource !== "undefined" &&
    MediaSource.isTypeSupported("audio/mpeg") &&
    response.body !== null;

  if (!canStream) {
    const blob = await response.blob();
    if (isAborted()) return;
    await playBlob(blob, isAborted);
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
      try { mediaSource.endOfStream(); } catch { /* already closing */ }
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

export interface SpeakHandle {
  /** Resolves when playback finishes or is cancelled. */
  done: Promise<void>;
  /** Immediately stop playback. */
  cancel: () => void;
}

/**
 * Play `text` through Julie's TTS voice.
 *
 * Returns a `SpeakHandle` with `{ done, cancel }` so the caller can both
 * await completion and cancel mid-stream (e.g. when the alarm is dismissed).
 *
 * Resolves silently if the backend is unreachable or the browser blocks audio.
 */
export function speakJulie(text: string): SpeakHandle {
  let aborted = false;
  const isAborted = () => aborted;

  const done = (async () => {
    try {
      const response = await openSpeechStream(text);
      if (aborted) return;
      await playAudioResponse(response, isAborted);
    } catch {
      // TTS unavailable — silent fallback (alarm toast is still visible).
    }
  })();

  return {
    done,
    cancel: () => { aborted = true; },
  };
}
