import { StyleSheet, View } from 'react-native';

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
 * `@react-native-community/datetimepicker` has no web implementation — this
 * `.web.tsx` sibling is what Expo's web bundler picks up instead, using
 * plain HTML date/time inputs so the app degrades sensibly for the web
 * target rather than crashing on an unresolvable native module.
 */
export function DateTimeField({ label, value, mode, onChange }: DateTimeFieldProps) {
  const theme = useTheme();
  const pad = (n: number) => String(n).padStart(2, '0');
  const htmlValue =
    mode === 'date'
      ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
      : `${pad(value.getHours())}:${pad(value.getMinutes())}`;

  function handleChange(raw: string) {
    if (!raw) return;
    const next = new Date(value);
    if (mode === 'date') {
      const [year, month, day] = raw.split('-').map(Number);
      next.setFullYear(year, month - 1, day);
    } else {
      const [hours, minutes] = raw.split(':').map(Number);
      next.setHours(hours, minutes, 0, 0);
    }
    onChange(next);
  }

  return (
    <View style={styles.wrapper}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      {/* eslint-disable-next-line react/forbid-elements -- web-only file; the native module this replaces has no web target */}
      <input
        type={mode}
        value={htmlValue}
        onChange={(event) => handleChange(event.target.value)}
        style={{
          backgroundColor: theme.backgroundElement,
          color: theme.text,
          border: 'none',
          borderRadius: Spacing.two,
          paddingTop: Spacing.two,
          paddingBottom: Spacing.two,
          paddingLeft: Spacing.three,
          paddingRight: Spacing.three,
          fontSize: 14,
          fontWeight: 700,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.one,
    flex: 1,
  },
});
