import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { CATEGORY_COLORS } from '@/constants/engagements';
import { Spacing } from '@/constants/theme';
import { formatClockTime, isSameDay, parseNaiveIso } from '@/lib/dates';
import type { Engagement } from '@/lib/types';
import { useTheme } from '@/hooks/use-theme';

const HOUR_HEIGHT = 60;
const GRID_HEIGHT = HOUR_HEIGHT * 24;
const HOUR_LABEL_WIDTH = 48;
const MIN_BLOCK_HEIGHT = 22;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

interface LaidOutBlock {
  engagement: Engagement;
  top: number;
  height: number;
  col: number;
  cols: number;
}

/** Positions each engagement in px within a 24h/`GRID_HEIGHT`-tall day, then
 * greedily assigns overlapping ones side-by-side columns (like Google
 * Calendar) instead of letting concurrent meetings stack on top of each other. */
function layoutDay(engagements: Engagement[], dayStart: Date): LaidOutBlock[] {
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
  const pxPerMinute = HOUR_HEIGHT / 60;

  const items = engagements
    .map((engagement) => {
      const start = parseNaiveIso(engagement.start_time);
      const end = parseNaiveIso(engagement.end_time);
      const clippedStart = start < dayStart ? dayStart : start;
      const clippedEnd = end > dayEnd ? dayEnd : end;
      const top = (clippedStart.getTime() - dayStart.getTime()) / 60_000 * pxPerMinute;
      const height = Math.max(
        ((clippedEnd.getTime() - clippedStart.getTime()) / 60_000) * pxPerMinute,
        MIN_BLOCK_HEIGHT,
      );
      return { engagement, top, height };
    })
    .sort((a, b) => a.top - b.top);

  const result: LaidOutBlock[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -Infinity;

  function flushCluster() {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    const withCols = cluster.map((item) => {
      let col = columnEnds.findIndex((end) => end <= item.top);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(item.top + item.height);
      } else {
        columnEnds[col] = item.top + item.height;
      }
      return { ...item, col };
    });
    const cols = columnEnds.length;
    for (const item of withCols) result.push({ ...item, cols });
    cluster = [];
  }

  for (const item of items) {
    if (cluster.length === 0 || item.top < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.top + item.height);
    } else {
      flushCluster();
      cluster = [item];
      clusterEnd = item.top + item.height;
    }
  }
  flushCluster();

  return result;
}

interface DayTimelineProps {
  /** The calendar day being shown — only its date portion matters. */
  day: Date;
  /** Engagements already filtered down to this day. */
  engagements: Engagement[];
  /** Working-hours window (minutes since midnight) to tint, if known — supports an overnight window where end < start. */
  shiftWindow?: { startMinutes: number; endMinutes: number } | null;
  onEngagementPress: (engagement: Engagement) => void;
  /** Called with a default one-hour window when the user taps blank timeline space. */
  onCreateAt: (start: Date, end: Date) => void;
}

export function DayTimeline({ day, engagements, shiftWindow, onEngagementPress, onCreateAt }: DayTimelineProps) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const dayStart = useMemo(() => {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    return start;
  }, [day]);

  const blocks = useMemo(() => layoutDay(engagements, dayStart), [engagements, dayStart]);

  const shiftBands = useMemo(() => {
    if (!shiftWindow) return [];
    const { startMinutes, endMinutes } = shiftWindow;
    const segments = startMinutes > endMinutes ? [[startMinutes, 24 * 60], [0, endMinutes]] : [[startMinutes, endMinutes]];
    return segments.map(([start, end]) => ({
      top: start * (HOUR_HEIGHT / 60),
      height: (end - start) * (HOUR_HEIGHT / 60),
    }));
  }, [shiftWindow]);

  // Jump straight to the interesting part of the day on mount / day change —
  // the earliest thing scheduled, or the shift start, whichever is earlier —
  // rather than dropping the user at a blank midnight.
  useEffect(() => {
    const earliestBlockHour = blocks.length > 0 ? blocks[0].top / HOUR_HEIGHT : 24;
    const shiftStartHour = shiftWindow ? shiftWindow.startMinutes / 60 : 7;
    const targetHour = Math.max(0, Math.min(earliestBlockHour, shiftStartHour) - 1);
    scrollRef.current?.scrollTo({ y: targetHour * HOUR_HEIGHT, animated: false });
    // Only re-run when the day itself changes — re-scrolling on every
    // engagement refetch would yank the view out from under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart]);

  function handleGridPress(event: GestureResponderEvent) {
    const totalMinutes = (event.nativeEvent.locationY / GRID_HEIGHT) * 24 * 60;
    const snapped = Math.min(24 * 60 - 15, Math.max(0, Math.round(totalMinutes / 15) * 15));
    const start = new Date(dayStart.getTime() + snapped * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    onCreateAt(start, end);
  }

  const isToday = isSameDay(day, now);
  const nowTop = isToday ? ((now.getTime() - dayStart.getTime()) / 60_000) * (HOUR_HEIGHT / 60) : null;

  return (
    <ScrollView ref={scrollRef} style={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.row}>
        <View style={{ width: HOUR_LABEL_WIDTH }}>
          {HOURS.map((hour) => (
            <View key={hour} style={styles.hourLabelSlot}>
              <Text style={[styles.hourLabel, { color: theme.textSecondary }]}>{formatHourLabel(hour)}</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.grid} onPress={handleGridPress}>
          {shiftBands.map((band, index) => (
            <View
              key={index}
              pointerEvents="none"
              style={[styles.shiftBand, { top: band.top, height: band.height, backgroundColor: theme.tint }]}
            />
          ))}

          {HOURS.map((hour) => (
            <View
              key={hour}
              pointerEvents="none"
              style={[styles.hourLine, { top: hour * HOUR_HEIGHT, borderColor: theme.border }]}
            />
          ))}

          {blocks.map((block) => {
            const color = CATEGORY_COLORS[block.engagement.category];
            const showTime = block.height >= 36;
            return (
              <Pressable
                key={block.engagement.id}
                onPress={() => onEngagementPress(block.engagement)}
                style={[
                  styles.block,
                  {
                    top: block.top,
                    height: block.height - 2,
                    left: `${(block.col / block.cols) * 100}%`,
                    width: `${100 / block.cols}%`,
                    backgroundColor: color,
                  },
                ]}>
                <Text numberOfLines={showTime ? 2 : 1} style={styles.blockTitle}>
                  {block.engagement.title}
                </Text>
                {showTime && (
                  <Text numberOfLines={1} style={styles.blockTime}>
                    {formatClockTime(parseNaiveIso(block.engagement.start_time))} –{' '}
                    {formatClockTime(parseNaiveIso(block.engagement.end_time))}
                  </Text>
                )}
              </Pressable>
            );
          })}

          {nowTop !== null && (
            <View pointerEvents="none" style={[styles.nowLine, { top: nowTop }]}>
              <View style={[styles.nowDot, { backgroundColor: theme.danger }]} />
              <View style={[styles.nowStroke, { backgroundColor: theme.danger }]} />
            </View>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
  },
  hourLabelSlot: {
    height: HOUR_HEIGHT,
    alignItems: 'flex-end',
    paddingRight: Spacing.two,
  },
  hourLabel: {
    fontSize: 10,
    fontWeight: '500',
    transform: [{ translateY: -6 }],
  },
  grid: {
    flex: 1,
    height: GRID_HEIGHT,
  },
  shiftBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    opacity: 0.06,
  },
  hourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  block: {
    position: 'absolute',
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.one + 2,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  blockTitle: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 13,
  },
  blockTime: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 10,
    lineHeight: 12,
    marginTop: 1,
  },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  nowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: -4,
  },
  nowStroke: {
    flex: 1,
    height: 1.5,
  },
});
