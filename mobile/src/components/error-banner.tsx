import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ErrorBanner({ message, style }: { message: string; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: theme.dangerBackground }, style]}>
      <ThemedText type="small" style={{ color: theme.danger }}>
        {message}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
});
