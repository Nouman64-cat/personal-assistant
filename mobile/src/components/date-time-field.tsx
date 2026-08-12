import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import RNDateTimePicker from '@react-native-community/datetimepicker';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface DateTimeFieldProps {
  label: string;
  value: Date;
  mode: 'date' | 'time';
  formatted: string;
  onChange: (date: Date) => void;
}

/**
 * iOS renders the community picker inline (it's a compact popover button,
 * not a modal) so it can just always be mounted. Android's date/time picker
 * is an OS-level dialog that pops up as soon as the component mounts, so it
 * has to be mounted on-demand (tap to open, unmount on select/dismiss) —
 * this is the documented cross-platform usage split for this library, not
 * an arbitrary choice.
 */
export function DateTimeField({ label, value, mode, formatted, onChange }: DateTimeFieldProps) {
  const theme = useTheme();
  const [androidOpen, setAndroidOpen] = useState(false);

  if (Platform.OS === 'ios') {
    return (
      <View style={styles.wrapper}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        <RNDateTimePicker value={value} mode={mode} display="compact" onValueChange={(_event, date) => onChange(date)} />
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Pressable
        onPress={() => setAndroidOpen(true)}
        style={[styles.field, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold">{formatted}</ThemedText>
      </Pressable>
      {androidOpen && (
        <RNDateTimePicker
          value={value}
          mode={mode}
          display="default"
          onValueChange={(_event, date) => {
            setAndroidOpen(false);
            onChange(date);
          }}
          onDismiss={() => setAndroidOpen(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.one,
    flex: 1,
  },
  field: {
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
});
