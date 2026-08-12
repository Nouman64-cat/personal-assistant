import { StyleSheet, View } from 'react-native';

import { CategoryPill } from '@/components/category-pill';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatClockTime, formatDayLabel, parseNaiveIso } from '@/lib/dates';
import type { ConflictInfo, EngagementAction, LookedUpEngagement } from '@/lib/types';
import { useTheme } from '@/hooks/use-theme';

export interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  actions?: EngagementAction[];
  conflict?: ConflictInfo | null;
  lookedUpEngagements?: LookedUpEngagement[];
}

const ACTION_LABEL: Record<EngagementAction['type'], string> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
};

function ActionCard({ action }: { action: EngagementAction }) {
  const theme = useTheme();
  const { engagement, type } = action;
  const start = parseNaiveIso(engagement.start_time);
  const end = parseNaiveIso(engagement.end_time);
  const tone = type === 'created' ? theme.success : type === 'deleted' ? theme.danger : theme.tint;

  return (
    <View style={[styles.infoCard, { backgroundColor: theme.backgroundElement, borderColor: tone }]}>
      <ThemedText type="small" style={{ color: tone, fontWeight: '700' }}>
        {ACTION_LABEL[type]}
      </ThemedText>
      <ThemedText type="smallBold" numberOfLines={1}>
        {engagement.title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {formatDayLabel(start)} · {formatClockTime(start)} – {formatClockTime(end)}
      </ThemedText>
    </View>
  );
}

function LookedUpCard({ engagement }: { engagement: LookedUpEngagement }) {
  const theme = useTheme();
  const start = new Date(engagement.start_time);
  const end = new Date(engagement.end_time);
  return (
    <View style={[styles.infoCard, { backgroundColor: theme.backgroundElement, borderColor: theme.tint }]}>
      <View style={styles.lookupHeader}>
        <Icon name="calendar" size={14} color={theme.tint} />
        <ThemedText type="smallBold" numberOfLines={1} style={styles.lookupTitle}>
          {engagement.title}
        </ThemedText>
      </View>
      <CategoryPill category={engagement.category} />
      <ThemedText type="small" themeColor="textSecondary">
        {formatDayLabel(start)} · {formatClockTime(start)} – {formatClockTime(end)}
      </ThemedText>
    </View>
  );
}

function ConflictBanner({ conflict }: { conflict: ConflictInfo }) {
  const theme = useTheme();
  const tone = conflict.available ? theme.success : theme.danger;
  const start = new Date(conflict.attempted_start_time);
  const end = new Date(conflict.attempted_end_time);
  return (
    <View style={[styles.infoCard, { backgroundColor: theme.backgroundElement, borderColor: tone }]}>
      <ThemedText type="small" style={{ color: tone, fontWeight: '700' }}>
        {conflict.available ? 'Free' : 'Conflict'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {formatClockTime(start)} – {formatClockTime(end)}
        {!conflict.available && conflict.conflicting_with ? ` clashes with "${conflict.conflicting_with.title}"` : ''}
      </ThemedText>
    </View>
  );
}

export function ChatBubble({ message }: { message: DisplayMessage }) {
  const theme = useTheme();
  const isUser = message.role === 'user';

  return (
    <View style={[styles.row, isUser && styles.rowEnd]}>
      <View
        style={[
          styles.bubble,
          isUser
            ? { backgroundColor: theme.tint, borderBottomRightRadius: Spacing.half }
            : { backgroundColor: theme.backgroundElement, borderBottomLeftRadius: Spacing.half },
        ]}>
        <ThemedText type="small" style={{ color: isUser ? '#ffffff' : theme.text }}>
          {message.content}
        </ThemedText>
      </View>

      {!isUser && message.actions && message.actions.length > 0 && (
        <View style={styles.infoStack}>
          {message.actions.map((action, index) => (
            <ActionCard key={`${action.engagement.id}-${index}`} action={action} />
          ))}
        </View>
      )}
      {!isUser && message.lookedUpEngagements && message.lookedUpEngagements.length > 0 && (
        <View style={styles.infoStack}>
          {message.lookedUpEngagements.map((engagement) => (
            <LookedUpCard key={engagement.id} engagement={engagement} />
          ))}
        </View>
      )}
      {!isUser && message.conflict && (
        <View style={styles.infoStack}>
          <ConflictBanner conflict={message.conflict} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    gap: Spacing.one,
    maxWidth: '85%',
  },
  rowEnd: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  bubble: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  infoStack: {
    width: '100%',
    gap: Spacing.one,
  },
  infoCard: {
    borderRadius: Spacing.two,
    borderLeftWidth: 3,
    padding: Spacing.two + 2,
    gap: 2,
  },
  lookupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  lookupTitle: {
    flex: 1,
  },
});
