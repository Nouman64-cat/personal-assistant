import { Pressable, StyleSheet, View } from 'react-native';

import { CategoryPill } from '@/components/category-pill';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { CATEGORY_COLORS } from '@/constants/engagements';
import { Spacing } from '@/constants/theme';
import { formatClockTime, formatDayLabel, parseNaiveIso } from '@/lib/dates';
import type { Engagement } from '@/lib/types';
import { useTheme } from '@/hooks/use-theme';

interface EngagementCardProps {
  engagement: Engagement;
  onPress: () => void;
  onDelete: () => void;
}

export function EngagementCard({ engagement, onPress, onDelete }: EngagementCardProps) {
  const theme = useTheme();
  const start = parseNaiveIso(engagement.start_time);
  const end = parseNaiveIso(engagement.end_time);
  const accent = CATEGORY_COLORS[engagement.category];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 },
      ]}>
      <View style={[styles.accentBar, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
            {engagement.title}
          </ThemedText>
          <Pressable hitSlop={10} onPress={onDelete}>
            <Icon name="trash" color={theme.danger} size={16} />
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDayLabel(start)} · {formatClockTime(start)} – {formatClockTime(end)}
        </ThemedText>
        <View style={styles.footerRow}>
          <CategoryPill category={engagement.category} />
          {!engagement.is_blocking && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.reminderNote}>
              Reminder only
            </ThemedText>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  accentBar: {
    width: 4,
  },
  body: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.half,
  },
  reminderNote: {
    fontStyle: 'italic',
  },
});
