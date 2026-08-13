import { Pressable, StyleSheet } from 'react-native';

import { Icon } from '@/components/icon';
import { Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Floating "add engagement" button shared by the Calendar and Engagements screens. */
export function Fab({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.fab, Shadows.raised, { backgroundColor: theme.tint }]}
      accessibilityLabel="Add engagement">
      <Icon name="add" color="#ffffff" size={24} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: Spacing.four,
    bottom: Spacing.four,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
