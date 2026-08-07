export type EngagementCategory =
  | "meeting"
  | "interview"
  | "office_hours"
  | "personal";

/**
 * All datetime fields from the API are naive ISO-8601 strings
 * (e.g. "2026-08-10T09:30:00") representing UTC wall-clock time with no
 * offset. Use `parseNaiveIso` from `@/lib/utils` to read them.
 */
export interface Engagement {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  category: EngagementCategory;
  is_blocking: boolean;
}

export interface EngagementInput {
  title: string;
  description?: string | null;
  start_time: string;
  end_time: string;
  category: EngagementCategory;
  is_blocking?: boolean;
}

export interface ParsedEngagement {
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  category: EngagementCategory;
  is_blocking: boolean;
  has_conflict: boolean;
}

export interface ParseRequest {
  text: string;
  timezone?: string;
  reference_datetime?: string;
}

export interface ParseResponse {
  engagements: ParsedEngagement[];
  warnings: string[];
}

export interface FreeSlotItem {
  start_time: string;
  end_time: string;
  duration_minutes: number;
}

export interface FreeSlotsResponse {
  slots: FreeSlotItem[];
}

export interface FreeSlotsParams {
  date_from: string;
  date_to: string;
  day_start_hour?: string;
  day_end_hour?: string;
  min_duration_minutes?: number;
}

/**
 * The user's saved working hours (e.g. "9 AM to 6 PM, Asia/Karachi"), used as
 * the default window for availability. `day_start_hour`/`day_end_hour` are
 * "HH:MM:SS" and are meant to be interpreted in `timezone`.
 */
export interface ShiftSettings {
  day_start_hour: string;
  day_end_hour: string;
  timezone: string;
}

export interface ShiftSettingsInput {
  day_start_hour: string;
  day_end_hour: string;
  timezone: string;
}
