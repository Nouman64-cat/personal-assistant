/**
 * The Web Speech API's `SpeechRecognition` interface has no official TS lib
 * definition (lib.dom.d.ts only ships the SpeechSynthesis half plus a few
 * leftover result/alternative types) — declared here for the wake-word
 * listener in useWakeWordVoice.ts. Chrome/Edge only, behind the
 * `webkitSpeechRecognition` prefix.
 */
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface Window {
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
}
