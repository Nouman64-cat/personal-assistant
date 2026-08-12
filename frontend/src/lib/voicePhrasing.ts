import type { ChatMessageResponse, EngagementAction, LookedUpEngagement } from "@/lib/types";
import { formatClockTime, formatDayLabel, parseNaiveIso } from "@/lib/utils";

/** `EngagementAction.engagement` timestamps are naive UTC (see the docstring on the `Engagement` type). */
function describeNaiveWindow(startIso: string, endIso: string): string {
  const start = parseNaiveIso(startIso);
  const end = parseNaiveIso(endIso);
  return `${formatDayLabel(start)} from ${formatClockTime(start)} to ${formatClockTime(end)}`;
}

/** `LookedUpEngagement`/`ConflictInfo` timestamps are already offset-aware local strings. */
function describeLocalWindow(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return `${formatDayLabel(start)} from ${formatClockTime(start)} to ${formatClockTime(end)}`;
}

function describeAction(action: EngagementAction): string {
  const { engagement, type } = action;
  const when = describeNaiveWindow(engagement.start_time, engagement.end_time);
  switch (type) {
    case "created":
      return `I've added "${engagement.title}" for ${when}.`;
    case "updated":
      return `I've updated "${engagement.title}" — it's now ${when}.`;
    case "deleted":
      return `I've removed "${engagement.title}" from your calendar.`;
  }
}

function describeLookup(engagements: LookedUpEngagement[]): string {
  if (engagements.length === 1) {
    const engagement = engagements[0];
    return `"${engagement.title}" is ${describeLocalWindow(engagement.start_time, engagement.end_time)}.`;
  }
  const items = engagements
    .slice(0, 4)
    .map((engagement) => `"${engagement.title}" at ${formatClockTime(new Date(engagement.start_time))}`)
    .join(", ");
  return `You have ${engagements.length} engagements: ${items}.`;
}

/**
 * Builds a short, natural line to speak back for a voice turn.
 *
 * The on-screen `reply` is written for reading — it can run a full
 * paragraph explaining a CRUD confirmation or a lookup answer. Speaking
 * that verbatim is what made Bella sound like she was reading a report
 * instead of talking to you. This picks the concrete outcome (what was
 * done, or what was found) straight out of the structured turn data
 * already on `response` — no extra network round trip, so it doesn't cost
 * any of the latency work already done for streaming playback.
 *
 * Falls back to the written `reply` for turns without one of those
 * signals (e.g. "what's free this week") — that prose is usually short
 * enough to speak directly.
 */
export function buildSpokenReply(response: ChatMessageResponse): string {
  let body: string;
  if (response.actions.length > 0) {
    body = response.actions.map(describeAction).join(" ");
  } else if (response.looked_up_engagements.length > 0) {
    body = describeLookup(response.looked_up_engagements);
  } else if (response.conflict) {
    const conflict = response.conflict;
    body = conflict.available
      ? `Yes, you're free ${describeLocalWindow(conflict.attempted_start_time, conflict.attempted_end_time)}.`
      : `That conflicts with "${conflict.conflicting_with?.title ?? "another engagement"}", so I couldn't do that.`;
  } else {
    body = response.reply;
  }
  return `Lord, ${body}`;
}
