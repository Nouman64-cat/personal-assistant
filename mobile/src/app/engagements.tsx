import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EngagementCard } from '@/components/engagement-card';
import { EngagementFormModal } from '@/components/engagement-form-modal';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError, deleteEngagement, listEngagements } from '@/lib/api';
import { formatDayLabel, isSameDay, parseNaiveIso } from '@/lib/dates';
import type { Engagement } from '@/lib/types';
import { useTheme } from '@/hooks/use-theme';

type ModalState = { mode: 'create' } | { mode: 'edit'; engagement: Engagement };

interface Section {
  title: string;
  data: Engagement[];
}

function sectionTitleFor(date: Date, today: Date): string {
  if (isSameDay(date, today)) return 'Today';
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(date, tomorrow)) return 'Tomorrow';
  return formatDayLabel(date);
}

function groupBySection(engagements: Engagement[]): Section[] {
  const today = new Date();
  const sorted = [...engagements].sort(
    (a, b) => parseNaiveIso(a.start_time).getTime() - parseNaiveIso(b.start_time).getTime(),
  );
  const sections: Section[] = [];
  for (const engagement of sorted) {
    const start = parseNaiveIso(engagement.start_time);
    const title = sectionTitleFor(start, today);
    const lastSection = sections[sections.length - 1];
    if (lastSection && lastSection.title === title) {
      lastSection.data.push(engagement);
    } else {
      sections.push({ title, data: [engagement] });
    }
  }
  return sections;
}

export default function EngagementsScreen() {
  const theme = useTheme();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState | null>(null);

  const load = useCallback(async (background = false) => {
    if (background) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);
    try {
      const data = await listEngagements();
      setEngagements(data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Failed to load engagements.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return engagements;
    return engagements.filter((engagement) => engagement.title.toLowerCase().includes(trimmed));
  }, [engagements, query]);

  const sections = useMemo(() => groupBySection(filtered), [filtered]);

  function openCreate() {
    setModalState({ mode: 'create' });
  }

  function openEdit(engagement: Engagement) {
    setModalState({ mode: 'edit', engagement });
  }

  function handleSaved() {
    setModalState(null);
    load(true);
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
            load(true);
          } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : 'Failed to delete engagement.');
          }
        },
      },
    ]);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>
            Engagements
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Everything on your calendar, past and upcoming.
          </ThemedText>
        </View>

        <View style={[styles.searchBar, { backgroundColor: theme.backgroundElement }]}>
          <Icon name="engagements" size={16} color={theme.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search engagements…"
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
          />
        </View>

        {error && (
          <View style={[styles.errorBanner, { backgroundColor: theme.dangerBackground }]}>
            <ThemedText type="small" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          </View>
        )}

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} tintColor={theme.tint} />}
          renderSectionHeader={({ section }) => (
            <ThemedView type="background" style={styles.sectionHeader}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {section.title.toUpperCase()}
              </ThemedText>
            </ThemedView>
          )}
          renderItem={({ item }) => (
            <View style={styles.cardWrapper}>
              <EngagementCard engagement={item} onPress={() => openEdit(item)} onDelete={() => requestDelete(item)} />
            </View>
          )}
          ListEmptyComponent={
            !isLoading ? (
              <View style={styles.emptyState}>
                <ThemedText type="small" themeColor="textSecondary">
                  {query ? 'No engagements match your search.' : 'Nothing on the calendar yet.'}
                </ThemedText>
              </View>
            ) : null
          }
        />

        <Pressable
          onPress={openCreate}
          style={[styles.fab, { backgroundColor: theme.tint }]}
          accessibilityLabel="Add engagement">
          <Icon name="add" color="#ffffff" size={24} />
        </Pressable>
      </SafeAreaView>

      {modalState && (
        <EngagementFormModal
          key={modalState.mode === 'edit' ? modalState.engagement.id : 'create'}
          visible
          mode={modalState.mode}
          initialStart={
            modalState.mode === 'edit' ? parseNaiveIso(modalState.engagement.start_time) : nextHour()
          }
          initialEnd={
            modalState.mode === 'edit' ? parseNaiveIso(modalState.engagement.end_time) : nextHourPlusOne()
          }
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

function nextHour(): Date {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return date;
}

function nextHourPlusOne(): Date {
  const date = nextHour();
  date.setHours(date.getHours() + 1);
  return date;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    gap: Spacing.half,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginBottom: Spacing.three,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  errorBanner: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: 120,
  },
  sectionHeader: {
    paddingVertical: Spacing.two,
  },
  cardWrapper: {
    marginBottom: Spacing.two,
  },
  emptyState: {
    paddingTop: Spacing.six,
    alignItems: 'center',
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
