import { create as createAxiosInstance, type AxiosError, type AxiosInstance } from 'axios';

import { API_BASE_URL } from '@/lib/env';
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
} from '@/lib/types';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface FastApiValidationError {
  msg?: string;
}

function extractErrorDetail(error: AxiosError): string {
  const body = error.response?.data as { detail?: unknown } | undefined;
  const detail = body?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = (detail as FastApiValidationError[])
      .map((entry) => entry?.msg)
      .filter((msg): msg is string => Boolean(msg));
    if (messages.length > 0) return messages.join('; ');
  }
  if (error.response) return `Request failed with status ${error.response.status}`;
  return `Could not reach the API server. Is the backend running at ${API_BASE_URL}?`;
}

/**
 * The one axios instance the whole app calls through — a single shared
 * baseURL/timeout/header config and a single place (the interceptor below)
 * that normalizes every failure into an `ApiError`, instead of each screen
 * reaching for its own axios.get/post and re-deriving error handling.
 */
export const apiClient: AxiosInstance = createAxiosInstance({
  baseURL: `${API_BASE_URL}/api/v1`,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status ?? 0;
    return Promise.reject(new ApiError(extractErrorDetail(error), status));
  },
);

// --- Engagements -----------------------------------------------------------

export async function listEngagements(): Promise<Engagement[]> {
  const { data } = await apiClient.get<Engagement[]>('/engagements/');
  return data;
}

export async function createEngagement(input: EngagementInput): Promise<Engagement> {
  const { data } = await apiClient.post<Engagement>('/engagements/', input);
  return data;
}

export async function updateEngagement(id: string, input: EngagementInput): Promise<Engagement> {
  const { data } = await apiClient.patch<Engagement>(`/engagements/${id}`, input);
  return data;
}

export async function deleteEngagement(id: string): Promise<void> {
  await apiClient.delete(`/engagements/${id}`);
}

// --- Chat --------------------------------------------------------------------

export async function sendChatMessage(payload: ChatMessageRequest): Promise<ChatMessageResponse> {
  const { data } = await apiClient.post<ChatMessageResponse>('/chat/messages', payload);
  return data;
}

export async function getChatHistory(sessionId: string): Promise<ChatHistoryResponse> {
  const { data } = await apiClient.get<ChatHistoryResponse>(`/chat/${sessionId}/messages`);
  return data;
}

// --- Availability ------------------------------------------------------------

export async function getFreeSlots(params: FreeSlotsParams): Promise<FreeSlotsResponse> {
  const { data } = await apiClient.get<FreeSlotsResponse>('/availability/free-slots', {
    params: {
      date_from: params.date_from,
      date_to: params.date_to,
      day_start_hour: params.day_start_hour,
      day_end_hour: params.day_end_hour,
      min_duration_minutes: params.min_duration_minutes,
    },
  });
  return data;
}

// --- Shift settings ----------------------------------------------------------

export async function getShiftSettings(): Promise<ShiftSettings> {
  const { data } = await apiClient.get<ShiftSettings>('/settings/shift');
  return data;
}

export async function updateShiftSettings(input: ShiftSettingsInput): Promise<ShiftSettings> {
  const { data } = await apiClient.put<ShiftSettings>('/settings/shift', input);
  return data;
}

// --- Voice ---------------------------------------------------------------

/**
 * Uploads a recorded command clip (a local file URI from `expo-audio`'s
 * recorder) to `gpt-4o-mini-transcribe` and returns the transcript. RN's
 * `FormData` takes a `{ uri, name, type }` object for file fields — it has
 * no `Blob` in the DOM sense, hence the cast (the standard, unavoidable
 * pattern for RN file uploads; DOM's `FormData.append` types don't know
 * about this shape).
 */
export async function transcribeVoiceFile(uri: string): Promise<string> {
  const formData = new FormData();
  formData.append('audio', { uri, name: 'command.m4a', type: 'audio/m4a' } as unknown as Blob);
  const { data } = await apiClient.post<{ text: string }>('/chat/voice/transcribe', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.text;
}

/**
 * Builds the URL for the GET variant of the speak endpoint — `expo-audio`'s
 * `useAudioPlayer` takes a bare URL (it can't POST a body the way the web
 * client's `fetch`-based streaming does), so playback goes straight through
 * this rather than through `apiClient`.
 */
export function getSpeakUrl(text: string): string {
  return `${API_BASE_URL}/api/v1/chat/voice/speak?text=${encodeURIComponent(text)}`;
}
