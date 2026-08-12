import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EngagementCard } from '@/components/engagement-card';
import { EngagementFormModal } from '@/components/engagement-form-modal';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError, deleteEngagement, getFreeSlots, getShiftSettings, listEngagements } from '@/lib/api';
import {
  addDays,
  formatClockTime,
  formatDuration,
  isSameDay,
  parseNaiveIso,
  toDateKey,
  toUtcBoundary,
} from '@/lib/dates';
import type { Engagement, FreeSlotItem, ShiftSettings } from '@/lib/types';
import { useTheme } from '@/hooks/use-theme';

type ModalState = { mode: 'create' } | { mode: 'edit'; engagement: Engagement };

const VISIBLE_DAYS = 7;

function buildWeek(anchor: Date): Date[] {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: VISIBLE_DAYS }, (_, index) => addDays(start, index));
}

export default function CalendarScreen() {
  const theme = useTheme();
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [shift, setShift] = useState<ShiftSettings | null>(null);
  const [freeSlots, setFreeSlots] = useState<FreeSlotItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState | null>(null);

  const week = useMemo(() => buildWeek(weekAnchor), [weekAnchor]);

  const loadEngagements = useCallback(async () => {
    setError(null);
    try {
      const [engagementList, shiftSettings] = await Promise.all([listEngagements(), getShiftSettings()]);
      setEngagements(engagementList);
      setShift(shiftSettings);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to load your calendar.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEngagements();
  }, [loadEngagements]);

  const loadFreeSlots = useCallback(async () => {
    if (!shift) return;
    setIsLoadingSlots(true);
    try {
      const dateKey = toDateKey(selectedDate);
      const dayStartHour = shift.day_start_hour.slice(0, 5);
      const dayEndHour = shift.day_end_hour.slice(0, 5);
      const isOvernight = dayStartHour > dayEndHour;
      const startBoundary = toUtcBoundary(dateKey, dayStartHour);
      const endHourAnchor = isOvernight ? toDateKey(addDays(selectedDate, 1)) : dateKey;
      const endBoundary = toUtcBoundary(endHourAnchor, dayEndHour);
      const response = await getFreeSlots({
        date_from: startBoundary.dateKey,
        date_to: startBoundary.dateKey,
        day_start_hour: startBoundary.time,
        day_end_hour: endBoundary.time,
        min_duration_minutes: 30,
      });
      setFreeSlots(response.slots);
    } catch {
      setFreeSlots([]);
    } finally {
      setIsLoadingSlots(false);
    }
  }, [shift, selectedDate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFreeSlots();
  }, [loadFreeSlots]);

  const dayEngagements = useMemo(
    () =>
      engagements
        .filter((engagement) => isSameDay(parseNaiveIso(engagement.start_time), selectedDate))
        .sort((a, b) => parseNaiveIso(a.start_time).getTime() - parseNaiveIso(b.start_time).getTime()),
    [engagements, selectedDate],
  );

  function openCreate() {
    setModalState({ mode: 'create' });
  }

  function openEdit(engagement: Engagement) {
    setModalState({ mode: 'edit', engagement });
  }

  function handleSaved() {
    setModalState(null);
    loadEngagements();
  }

  function requestDelete(engagement: Engagement) {
    Alert.alert('Delete engagement?', `Remove "${engagement.title}" from your calendar.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteEngagement(engagement.id);
            loadEngagements();
          } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : 'Failed to delete engagement.');
          }
        },
      },
    ]);
  }

  function createDefaultsForSelectedDay(): { start: Date; end: Date } {
    const start = new Date(selectedDate);
    const now = new Date();
    if (isSameDay(selectedDate, now)) {
      start.setHours(now.getHours() + 1, 0, 0, 0);
    } else {
      start.setHours(9, 0, 0, 0);
    }
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    return { start, end };
  }

  const createDefaults = modalState?.mode === 'create' ? createDefaultsForSelectedDay() : null;

  if (isLoading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.tint} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>
            Calendar
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Where you actually have time, and what&apos;s already booked.
          </ThemedText>
        </View>

        <View style={styles.weekNav}>
          <Pressable onPress={() => setWeekAnchor((date) => addDays(date, -VISIBLE_DAYS))} hitSlop={10}>
            <Icon name="chevronLeft" color={theme.textSecondary} size={18} />
          </Pressable>
          <Pressable
            onPress={() => {
              const today = new Date();
              setWeekAnchor(today);
              setSelectedDate(today);
            }}>
            <ThemedText type="small" style={{ color: theme.tint, fontWeight: '600' }}>
              Today
            </ThemedText>
          </Pressable>
          <Pressable onPress={() => setWeekAnchor((date) => addDays(date, VISIBLE_DAYS))} hitSlop={10}>
            <Icon name="chevronRight" color={theme.textSecondary} size={18} />
          </Pressable>
        </View>

        <View style={styles.weekStrip}>
          {week.map((date) => {
            const selected = isSameDay(date, selectedDate);
            const today = isSameDay(date, new Date());
            const hasEngagements = engagements.some((engagement) =>
              isSameDay(parseNaiveIso(engagement.start_time), date),
            );
            return (
              <Pressable
                key={toDateKey(date)}
                onPress={() => setSelectedDate(date)}
                style={[
                  styles.dayChip,
                  selected && { backgroundColor: theme.tint },
                  !selected && today && { borderWidth: 1.5, borderColor: theme.tint },
                ]}>
                <ThemedText
                  type="small"
                  style={{ color: selected ? '#ffffff' : theme.textSecondary, fontSize: 11 }}>
                  {date.toLocaleDateString('en-US', { weekday: 'short' })}
                </ThemedText>
                <ThemedText type="smallBold" style={{ color: selected ? '#ffffff' : theme.text }}>
                  {date.getDate()}
                </ThemedText>
                {hasEngagements && <View style={[styles.dayDot, { backgroundColor: selected ? '#ffffff' : theme.tint }]} />}
              </Pressable>
            );
          })}
        </View>

        {error && (
          <View style={[styles.errorBanner, { backgroundColor: theme.dangerBackground }]}>
            <ThemedText type="small" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          </View>
        )}

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.sectionHeaderRow}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              FREE TODAY
            </ThemedText>
            {isLoadingSlots && <ActivityIndicator size="small" color={theme.tint} />}
          </View>
          {freeSlots.length === 0 && !isLoadingSlots ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.noSlotsText}>
              No open slots in your shift window.
            </ThemedText>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.slotRow}>
              {freeSlots.map((slot, index) => {
                const start = new Date(slot.start_time);
                const end = new Date(slot.end_time);
                return (
                  <View key={index} style={[styles.slotPill, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="small" style={{ color: theme.success, fontWeight: '600' }}>
                      {formatClockTime(start)} – {formatClockTime(end)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatDuration(slot.duration_minutes)}
                    </ThemedText>
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.sectionHeaderRow}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              ENGAGEMENTS
            </ThemedText>
          </View>
          {dayEngagements.length === 0 ? (
            <View style={styles.emptyState}>
              <ThemedText type="small" themeColor="textSecondary">
                Nothing scheduled this day.
              </ThemedText>
            </View>
          ) : (
            <View style={styles.cardStack}>
              {dayEngagements.map((engagement) => (
                <EngagementCard
                  key={engagement.id}
                  engagement={engagement}
                  onPress={() => openEdit(engagement)}
                  onDelete={() => requestDelete(engagement)}
                />
              ))}
            </View>
          )}
        </ScrollView>

        <Pressable onPress={openCreate} style={[styles.fab, { backgroundColor: theme.tint }]} accessibilityLabel="Add engagement">
          <Icon name="add" color="#ffffff" size={24} />
        </Pressable>
      </SafeAreaView>

      {modalState && (
        <EngagementFormModal
          key={modalState.mode === 'edit' ? modalState.engagement.id : `create-${toDateKey(selectedDate)}`}
          visible
          mode={modalState.mode}
          initialStart={
            modalState.mode === 'edit' ? parseNaiveIso(modalState.engagement.start_time) : createDefaults!.start
          }
          initialEnd={modalState.mode === 'edit' ? parseNaiveIso(modalState.engagement.end_time) : createDefaults!.end}
          initialTitle={modalState.mode === 'edit' ? modalState.engagement.title : undefined}
          initialDescription={modalState.mode === 'edit' ? modalState.engagement.description : undefined}
          initialCategory={modalState.mode === 'edit' ? modalState.engagement.category : undefined}
          initialIsBlocking={modalState.mode === 'edit' ? modalState.engagement.is_blocking : undefined}
          engagementId={modalState.mode === 'edit' ? modalState.engagement.id : undefined}
          onClose={() => setModalState(null)}
          onSaved={handleSaved}
        />
      )}
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
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.half,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
  },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
    paddingVertical: Spacing.two,
  },
  weekStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    marginBottom: Spacing.three,
  },
  dayChip: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: Spacing.two,
    minWidth: 40,
  },
  dayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 2,
  },
  errorBanner: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: 120,
    gap: Spacing.two,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  noSlotsText: {
    marginBottom: Spacing.two,
  },
  slotRow: {
    marginBottom: Spacing.two,
  },
  slotPill: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginRight: Spacing.two,
    alignItems: 'center',
  },
  emptyState: {
    paddingVertical: Spacing.four,
    alignItems: 'center',
  },
  cardStack: {
    gap: Spacing.two,
  },
  fab: {
    position: 'absolute',
    right: Spacing.four,
    bottom: Spacing.four,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
