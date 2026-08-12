import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { DateTimeField } from '@/components/date-time-field';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_OPTIONS } from '@/constants/engagements';
import { Spacing } from '@/constants/theme';
import { ApiError, createEngagement, deleteEngagement, updateEngagement } from '@/lib/api';
import { formatClockTime, formatDayLabel } from '@/lib/dates';
import type { Engagement, EngagementCategory } from '@/lib/types';
import { useTheme } from '@/hooks/use-theme';

interface EngagementFormModalProps {
  visible: boolean;
  mode: 'create' | 'edit';
  initialStart: Date;
  initialEnd: Date;
  initialTitle?: string;
  initialDescription?: string | null;
  initialCategory?: EngagementCategory;
  initialIsBlocking?: boolean;
  /** Required in edit mode — the engagement being updated/deleted. */
  engagementId?: string;
  onClose: () => void;
  /** Called after a successful create/update/delete so the parent can refetch and close. */
  onSaved: () => void;
}

/** Applies an edited date/time-of-day to a copy of `date`, keeping the other half intact. */
function mergeDatePart(base: Date, patch: Date, part: 'date' | 'time'): Date {
  const next = new Date(base);
  if (part === 'date') {
    next.setFullYear(patch.getFullYear(), patch.getMonth(), patch.getDate());
  } else {
    next.setHours(patch.getHours(), patch.getMinutes(), 0, 0);
  }
  return next;
}

export function EngagementFormModal({
  visible,
  mode,
  initialStart,
  initialEnd,
  initialTitle = '',
  initialDescription = '',
  initialCategory = 'meeting',
  initialIsBlocking = true,
  engagementId,
  onClose,
  onSaved,
}: EngagementFormModalProps) {
  const theme = useTheme();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [category, setCategory] = useState<EngagementCategory>(initialCategory);
  const [isBlocking, setIsBlocking] = useState(initialIsBlocking);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seeds the form fresh every time the modal opens for a *different*
  // target — `key`-based remounting (see the callers) handles this more
  // simply than syncing props to state in an effect.

  async function handleSubmit() {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (start >= end) {
      setError('Start time must be before end time.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        category,
        is_blocking: isBlocking,
      };
      if (mode === 'create') {
        await createEngagement(payload);
      } else if (engagementId) {
        await updateEngagement(engagementId, payload);
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to save engagement.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!engagementId) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setIsDeleting(true);
    setError(null);
    try {
      await deleteEngagement(engagementId);
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to delete engagement.');
      setIsDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <ThemedText type="subtitle" style={styles.headerTitle}>
            {mode === 'create' ? 'New engagement' : 'Edit engagement'}
          </ThemedText>
          <Pressable onPress={onClose} hitSlop={10}>
            <Icon name="close" color={theme.textSecondary} size={22} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              Title
            </ThemedText>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Interview with Avalara"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
            />
          </View>

          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              Category
            </ThemedText>
            <View style={styles.categoryRow}>
              {CATEGORY_OPTIONS.map((option) => {
                const selected = option === category;
                const color = CATEGORY_COLORS[option];
                return (
                  <Pressable
                    key={option}
                    onPress={() => setCategory(option)}
                    style={[
                      styles.categoryChip,
                      { backgroundColor: selected ? color : theme.backgroundElement },
                    ]}>
                    <ThemedText
                      type="small"
                      style={{ color: selected ? '#ffffff' : theme.text, fontWeight: '600' }}>
                      {CATEGORY_LABELS[option]}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.row}>
            <DateTimeField
              label="Start date"
              mode="date"
              value={start}
              formatted={formatDayLabel(start)}
              onChange={(date) => setStart((previous) => mergeDatePart(previous, date, 'date'))}
            />
            <DateTimeField
              label="Start time"
              mode="time"
              value={start}
              formatted={formatClockTime(start)}
              onChange={(date) => setStart((previous) => mergeDatePart(previous, date, 'time'))}
            />
          </View>

          <View style={styles.row}>
            <DateTimeField
              label="End date"
              mode="date"
              value={end}
              formatted={formatDayLabel(end)}
              onChange={(date) => setEnd((previous) => mergeDatePart(previous, date, 'date'))}
            />
            <DateTimeField
              label="End time"
              mode="time"
              value={end}
              formatted={formatClockTime(end)}
              onChange={(date) => setEnd((previous) => mergeDatePart(previous, date, 'time'))}
            />
          </View>

          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              Description (optional)
            </ThemedText>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Add any notes…"
              placeholderTextColor={theme.textSecondary}
              multiline
              numberOfLines={3}
              style={[
                styles.input,
                styles.textArea,
                { backgroundColor: theme.backgroundElement, color: theme.text },
              ]}
            />
          </View>

          <View style={[styles.switchRow, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.switchLabel}>
              <ThemedText type="smallBold">Counts as busy time</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Shows on the calendar and blocks this slot from free-time search.
              </ThemedText>
            </View>
            <Switch value={isBlocking} onValueChange={setIsBlocking} trackColor={{ true: theme.tint }} />
          </View>

          {error && (
            <View style={[styles.errorBanner, { backgroundColor: theme.dangerBackground }]}>
              <ThemedText type="small" style={{ color: theme.danger }}>
                {error}
              </ThemedText>
            </View>
          )}

          <View style={styles.actions}>
            {mode === 'edit' && (
              <Button
                label={confirmingDelete ? 'Tap again to delete' : 'Delete'}
                variant="danger"
                onPress={handleDelete}
                loading={isDeleting}
              />
            )}
            <Button label={mode === 'create' ? 'Add' : 'Save'} onPress={handleSubmit} loading={isSaving} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 26,
  },
  form: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  categoryChip: {
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.five,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  switchLabel: {
    flex: 1,
    gap: 2,
  },
  errorBanner: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  actions: {
    gap: Spacing.two,
  },
});
