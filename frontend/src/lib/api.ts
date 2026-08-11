import type {
  ChatHistoryResponse,
  ChatMessageRequest,
  ChatMessageResponse,
  Engagement,
  EngagementInput,
  FreeSlotsParams,
  FreeSlotsResponse,
  ShiftSettings,
  ShiftSettingsInput,
} from "@/lib/types";

// Left unset (the default), requests go to a same-origin relative path and
// next.config.ts's rewrite forwards them server-side to the backend — this
// keeps things working no matter what URL the browser used to reach the
// frontend (localhost, a LAN IP, an ngrok tunnel, ...), with no CORS setup
// needed. Only set NEXT_PUBLIC_API_BASE_URL when the backend is genuinely on
// a different origin the browser must call directly (e.g. separately hosted
// in production).
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

const API_V1_URL = `${API_BASE_URL}/api/v1`;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface FastApiValidationError {
  msg?: string;
}

async function extractErrorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail)) {
        const messages = detail
          .map((entry: FastApiValidationError) => entry?.msg)
          .filter((msg): msg is string => Boolean(msg));
        if (messages.length > 0) return messages.join("; ");
      }
    }
  } catch {
    // Response body wasn't JSON; fall through to the status text.
  }
  return response.statusText || `Request failed with status ${response.status}`;
}

/** Shared fetch + connectivity/status handling. Returns the raw `Response`
 * so callers can parse JSON, a Blob (audio), or nothing, as appropriate —
 * `request` below is the common JSON-in/JSON-out case built on top of it. */
async function rawRequest(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_V1_URL}${path}`, {
      ...init,
      headers: {
        "ngrok-skip-browser-warning": "true",
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      API_BASE_URL
        ? `Could not reach the API server. Is the backend running at ${API_BASE_URL}?`
        : "Could not reach the API server. Is the backend running at http://localhost:8000?",
      0,
    );
  }

  if (!response.ok) {
    throw new ApiError(await extractErrorDetail(response), response.status);
  }

  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await rawRequest(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// --- Engagements -----------------------------------------------------------

export function listEngagements(): Promise<Engagement[]> {
  return request<Engagement[]>("/engagements/");
}

export function createEngagement(data: EngagementInput): Promise<Engagement> {
  return request<Engagement>("/engagements/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateEngagement(id: string, data: EngagementInput): Promise<Engagement> {
  return request<Engagement>(`/engagements/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteEngagement(id: string): Promise<void> {
  return request<void>(`/engagements/${id}`, { method: "DELETE" });
}

// --- Chat --------------------------------------------------------------------

export function sendChatMessage(payload: ChatMessageRequest): Promise<ChatMessageResponse> {
  return request<ChatMessageResponse>("/chat/messages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getChatHistory(sessionId: string): Promise<ChatHistoryResponse> {
  return request<ChatHistoryResponse>(`/chat/${sessionId}/messages`);
}

// --- Voice ---------------------------------------------------------------

/** Sends a recorded command clip to gpt-4o-mini-transcribe and returns the transcript. */
export async function transcribeVoice(audioBlob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "command.webm");
  // No Content-Type header here — the browser sets the multipart boundary
  // itself when the body is a FormData; setting it manually breaks the parse.
  const response = await rawRequest("/chat/voice/transcribe", { method: "POST", body: formData });
  const data = (await response.json()) as { text: string };
  return data.text;
}

/**
 * Opens a streamed gpt-4o-mini-tts synthesis of `text` and returns the raw
 * `Response` — the backend starts forwarding mp3 bytes as OpenAI produces
 * them, so the caller can start playback (via MediaSource, see
 * useWakeWordVoice) well before the full clip has finished generating.
 * Awaiting `.blob()` here would defeat that by buffering the whole stream
 * before resolving.
 */
export function openSpeechStream(text: string): Promise<Response> {
  return rawRequest("/chat/voice/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

// --- Availability ------------------------------------------------------------

export function getFreeSlots(params: FreeSlotsParams): Promise<FreeSlotsResponse> {
  const search = new URLSearchParams({
    date_from: params.date_from,
    date_to: params.date_to,
  });
  if (params.day_start_hour) search.set("day_start_hour", params.day_start_hour);
  if (params.day_end_hour) search.set("day_end_hour", params.day_end_hour);
  if (params.min_duration_minutes != null) {
    search.set("min_duration_minutes", String(params.min_duration_minutes));
  }
  return request<FreeSlotsResponse>(`/availability/free-slots?${search.toString()}`);
}

// --- Shift settings ----------------------------------------------------------

export function getShiftSettings(): Promise<ShiftSettings> {
  return request<ShiftSettings>("/settings/shift");
}

export function updateShiftSettings(data: ShiftSettingsInput): Promise<ShiftSettings> {
  return request<ShiftSettings>("/settings/shift", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
