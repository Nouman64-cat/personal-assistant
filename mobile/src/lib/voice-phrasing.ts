import { formatClockTime, formatDayLabel, parseNaiveIso } from '@/lib/dates';
import type { ChatMessageResponse, EngagementAction, LookedUpEngagement } from '@/lib/types';

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
    case 'created':
      return `I've added "${engagement.title}" for ${when}.`;
    case 'updated':
      return `I've updated "${engagement.title}" — it's now ${when}.`;
    case 'deleted':
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
    .join(', ');
  return `You have ${engagements.length} engagements: ${items}.`;
}

/**
 * Builds a short, natural line to speak back for a voice turn — mirrors the
 * web app's `buildSpokenReply` exactly (same reasoning: the on-screen
 * `reply` is written for reading and can run a full paragraph; this picks
 * the concrete outcome straight out of the structured turn data instead of
 * reading that paragraph verbatim, entirely client-side so it costs no
 * extra request).
 */
export function buildSpokenReply(response: ChatMessageResponse): string {
  let body: string;
  if (response.actions.length > 0) {
    body = response.actions.map(describeAction).join(' ');
  } else if (response.looked_up_engagements.length > 0) {
    body = describeLookup(response.looked_up_engagements);
  } else if (response.conflict) {
    const conflict = response.conflict;
    body = conflict.available
      ? `Yes, you're free ${describeLocalWindow(conflict.attempted_start_time, conflict.attempted_end_time)}.`
      : `That conflicts with "${conflict.conflicting_with?.title ?? 'another engagement'}", so I couldn't do that.`;
  } else {
    body = response.reply;
  }
  return body;
}
