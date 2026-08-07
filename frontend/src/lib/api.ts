import type {
  Engagement,
  EngagementInput,
  FreeSlotsParams,
  FreeSlotsResponse,
  ParseRequest,
  ParseResponse,
} from "@/lib/types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_V1_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      "Could not reach the API server. Is the backend running at " +
        `${API_BASE_URL}?`,
      0,
    );
  }

  if (!response.ok) {
    throw new ApiError(await extractErrorDetail(response), response.status);
  }

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

export function deleteEngagement(id: string): Promise<void> {
  return request<void>(`/engagements/${id}`, { method: "DELETE" });
}

// --- Natural language parsing ----------------------------------------------

export function parseEngagements(payload: ParseRequest): Promise<ParseResponse> {
  return request<ParseResponse>("/parse", {
    method: "POST",
    body: JSON.stringify(payload),
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
