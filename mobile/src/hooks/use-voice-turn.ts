import { useEffect, useRef, useState } from 'react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

import { getSpeakUrl, transcribeVoiceFile } from '@/lib/api';
import type { ChatMessageResponse } from '@/lib/types';
import { buildSpokenReply } from '@/lib/voice-phrasing';

/** Safety cap so a stuck recording (e.g. background noise, forgot to tap stop) can't run forever — mirrors the web app's MAX_RECORD_MS. */
const MAX_RECORD_SECONDS = 20;

export type VoiceTurnStatus = 'idle' | 'recording' | 'processing' | 'speaking';

interface UseVoiceTurnOptions {
  /** Runs the transcribed command through the normal chat turn; resolves with the full response so the spoken line can be built from it. */
  onCommand: (text: string) => Promise<ChatMessageResponse>;
}

interface UseVoiceTurnResult {
  status: VoiceTurnStatus;
  error: string | null;
  /** Recording level in dBFS (roughly -160 silence to 0 loudest) — drives the live level indicator while recording. */
  metering: number;
  durationMillis: number;
  /** Single button handler: starts recording from idle, stops (and sends) from recording, cuts playback short from speaking. */
  toggle: () => void;
}

/**
 * Tap-to-talk voice turn: record a command, transcribe it with the same
 * cheap gpt-4o-mini-transcribe endpoint the web app uses, run it through
 * the caller's normal chat-send path (so CRUD tool-calling is identical to
 * typed chat), then speak the reply back with gpt-4o-mini-tts.
 *
 * Unlike the web app's always-listening "Julie" wake word (built on the
 * browser's SpeechRecognition API, which has no native equivalent), this is
 * explicitly user-initiated — see the mobile voice-UX decision to use
 * tap-to-talk instead of adding a native wake-word module.
 */
export function useVoiceTurn({ onCommand }: UseVoiceTurnOptions): UseVoiceTurnResult {
  const [status, setStatus] = useState<VoiceTurnStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Deliberate: keeps the ref current every render so async callbacks below always see the latest onCommand.
  const onCommandRef = useRef(onCommand);
  // eslint-disable-next-line react-hooks/refs
  onCommandRef.current = onCommand;

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);

  useEffect(() => {
    if (status === 'speaking' && playerStatus.didJustFinish) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('idle');
    }
  }, [status, playerStatus.didJustFinish]);

  async function start() {
    setError(null);
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        setError("Microphone access was denied — allow it in the phone's settings to use voice.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: MAX_RECORD_SECONDS });
      setStatus('recording');
    } catch {
      setError("Couldn't access the microphone for the command.");
    }
  }

  async function stopAndSend() {
    setStatus('processing');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        setStatus('idle');
        return;
      }
      const text = (await transcribeVoiceFile(uri)).trim();
      if (!text) {
        setStatus('idle');
        return;
      }
      const response = await onCommandRef.current(text);
      const spoken = buildSpokenReply(response);
      setStatus('speaking');
      player.replace(getSpeakUrl(spoken));
      player.play();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong with that voice command.');
      setStatus('idle');
    }
  }

  function toggle() {
    if (status === 'idle') {
      void start();
    } else if (status === 'recording') {
      void stopAndSend();
    } else if (status === 'speaking') {
      player.pause();
      setStatus('idle');
    }
    // 'processing' — ignore taps until the current turn resolves.
  }

  return {
    status,
    error,
    metering: recorderState.metering ?? -160,
    durationMillis: recorderState.durationMillis,
    toggle,
  };
}
