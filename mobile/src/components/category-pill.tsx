import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '@/constants/engagements';
import { Spacing } from '@/constants/theme';
import type { EngagementCategory } from '@/lib/types';

export function CategoryPill({ category }: { category: EngagementCategory }) {
  const color = CATEGORY_COLORS[category];
  return (
    <View style={[styles.pill, { backgroundColor: `${color}22` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <ThemedText type="small" style={[styles.label, { color }]}>
        {CATEGORY_LABELS[category]}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: 3,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.five,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
});
