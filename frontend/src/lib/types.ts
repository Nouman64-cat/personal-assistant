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

export type EngagementActionType = "created" | "updated" | "deleted";

export interface EngagementAction {
  type: EngagementActionType;
  /** For a "deleted" action, this is a snapshot taken just before removal. */
  engagement: Engagement;
}

export interface ChatMessageRequest {
  session_id?: string | null;
  message: string;
  timezone?: string;
  reference_datetime?: string;
}

export interface ChatMessageResponse {
  session_id: string;
  reply: string;
  actions: EngagementAction[];
  /**
   * Unlike `FreeSlotItem`s from the REST /free-slots endpoint (naive UTC),
   * these come back as offset-aware ISO strings already in the user's local
   * timezone — parse directly with `new Date(...)`, not `parseNaiveIso`.
   */
  free_slots: FreeSlotItem[];
  /** What's occupying the busy stretches within free_slots' shift window —
   * same offset-aware-local convention as free_slots. */
  busy_engagements: BusyEngagementInfo[];
  /**
   * Present whenever this turn checked a specific time window against the
   * calendar — either a create/update that hit a conflict, or a direct
   * check_availability yes/no question. `available` says which widget to
   * render; `conflicting_with` is only set when it's false. Only on the live
   * turn's response, not replayed with chat history.
   */
  conflict?: ConflictInfo | null;
}

export interface ConflictInfo {
  available: boolean;
  attempted_title: string;
  attempted_start_time: string;
  attempted_end_time: string;
  conflicting_with: BusyEngagementInfo | null;
}

export interface ChatHistoryMessageDto {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  actions: EngagementAction[];
  free_slots: FreeSlotItem[];
  busy_engagements: BusyEngagementInfo[];
}

export interface BusyEngagementInfo {
  title: string;
  category: EngagementCategory;
  start_time: string;
  end_time: string;
}

export interface ChatHistoryResponse {
  session_id: string;
  messages: ChatHistoryMessageDto[];
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
