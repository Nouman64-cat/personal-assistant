import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { DateTimeField } from '@/components/date-time-field';
import { ErrorBanner } from '@/components/error-banner';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Shadows, Spacing } from '@/constants/theme';
import { formatClockTime } from '@/lib/dates';
import { ApiError, getShiftSettings, updateShiftSettings } from '@/lib/api';
import type { ShiftSettings } from '@/lib/types';
import { useTheme } from '@/hooks/use-theme';

const COMMON_TIMEZONES: { label: string; value: string }[] = [
  { label: 'Eastern (New York)', value: 'America/New_York' },
  { label: 'Central (Chicago)', value: 'America/Chicago' },
  { label: 'Mountain (Denver)', value: 'America/Denver' },
  { label: 'Pacific (Los Angeles)', value: 'America/Los_Angeles' },
  { label: 'London', value: 'Europe/London' },
  { label: 'UTC', value: 'UTC' },
];

const BUFFER_STEP = 5;
const BUFFER_MAX = 120;

function toInputTime(value: string): string {
  return value.slice(0, 5);
}

function timeStringToDate(time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return date;
}

function dateToTimeString(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function detectDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

export default function SettingsScreen() {
  const theme = useTheme();
  const [shift, setShift] = useState<ShiftSettings | null>(null);
  const [dayStartHour, setDayStartHour] = useState('09:00');
  const [dayEndHour, setDayEndHour] = useState('18:00');
  const [timezone, setTimezone] = useState('UTC');
  const [bufferMinutes, setBufferMinutes] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getShiftSettings();
      setShift(data);
      setDayStartHour(toInputTime(data.day_start_hour));
      setDayEndHour(toInputTime(data.day_end_hour));
      setTimezone(data.timezone);
      setBufferMinutes(data.buffer_minutes);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to load shift settings.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const rangeIsValid = dayStartHour !== dayEndHour;
  const isOvernight = dayStartHour > dayEndHour;
  const detected = detectDeviceTimezone();

  function markDirty() {
    setJustSaved(false);
    setError(null);
  }

  async function handleSave() {
    if (!rangeIsValid || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const updated = await updateShiftSettings({
        day_start_hour: dayStartHour,
        day_end_hour: dayEndHour,
        timezone,
        buffer_minutes: bufferMinutes,
      });
      setShift(updated);
      setJustSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to save shift.');
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.tint} />
      </ThemedView>
    );
  }

  if (!shift) {
    return (
      <ThemedView style={styles.centered}>
        <ErrorBanner message={error ?? 'Failed to load shift settings.'} style={styles.loadErrorBanner} />
        <Button label="Retry" onPress={load} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="pageTitle">Shift Settings</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Your working hours — used to compute free slots and detect conflicts.
            </ThemedText>
          </View>

          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">Working hours</ThemedText>
            <View style={styles.row}>
              <DateTimeField
                label="Start"
                mode="time"
                value={timeStringToDate(dayStartHour)}
                formatted={formatClockTime(timeStringToDate(dayStartHour))}
                onChange={(date) => {
                  markDirty();
                  setDayStartHour(dateToTimeString(date));
                }}
              />
              <DateTimeField
                label="End"
                mode="time"
                value={timeStringToDate(dayEndHour)}
                formatted={formatClockTime(timeStringToDate(dayEndHour))}
                onChange={(date) => {
                  markDirty();
                  setDayEndHour(dateToTimeString(date));
                }}
              />
            </View>
            {!rangeIsValid ? (
              <ThemedText type="small" style={{ color: theme.danger }}>
                Start and end can&apos;t be the same time.
              </ThemedText>
            ) : isOvernight ? (
              <ThemedText type="small" themeColor="textSecondary">
                Overnight shift — ends the next day.
              </ThemedText>
            ) : null}
          </View>

          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.cardHeaderRow}>
              <ThemedText type="smallBold">Timezone</ThemedText>
              {timezone !== detected && (
                <Pressable
                  onPress={() => {
                    markDirty();
                    setTimezone(detected);
                  }}>
                  <ThemedText type="small" style={{ color: theme.tint, fontWeight: '600' }}>
                    Use detected ({detected})
                  </ThemedText>
                </Pressable>
              )}
            </View>
            <View style={styles.chipWrap}>
              {COMMON_TIMEZONES.map((option) => {
                const selected = option.value === timezone;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      markDirty();
                      setTimezone(option.value);
                    }}
                    style={[styles.chip, { backgroundColor: selected ? theme.tint : theme.background }]}>
                    <ThemedText type="small" style={{ color: selected ? '#ffffff' : theme.text }}>
                      {option.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">Buffer around engagements</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Minimum gap kept around every engagement when suggesting free slots.
            </ThemedText>
            <View style={styles.stepperRow}>
              <Pressable
                onPress={() => {
                  markDirty();
                  setBufferMinutes((value) => Math.max(0, value - BUFFER_STEP));
                }}
                style={[styles.stepperButton, { backgroundColor: theme.background }]}>
                <Icon name="close" size={14} color={theme.text} />
              </Pressable>
              <ThemedText type="smallBold" style={styles.stepperValue}>
                {bufferMinutes} min
              </ThemedText>
              <Pressable
                onPress={() => {
                  markDirty();
                  setBufferMinutes((value) => Math.min(BUFFER_MAX, value + BUFFER_STEP));
                }}
                style={[styles.stepperButton, { backgroundColor: theme.background }]}>
                <Icon name="add" size={14} color={theme.text} />
              </Pressable>
            </View>
          </View>

          {error && <ErrorBanner message={error} />}

          <Button
            label={justSaved ? 'Saved ✓' : 'Save shift'}
            onPress={handleSave}
            loading={isSaving}
            disabled={!rangeIsValid}
          />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  loadErrorBanner: {
    alignSelf: 'stretch',
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.half,
    marginBottom: Spacing.two,
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
    ...Shadows.card,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.five,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 64,
    textAlign: 'center',
  },
});
