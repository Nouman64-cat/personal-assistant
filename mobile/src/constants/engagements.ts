import type { EngagementCategory } from '@/lib/types';

export const CATEGORY_LABELS: Record<EngagementCategory, string> = {
  meeting: 'Meeting',
  interview: 'Interview',
  office_hours: 'Office Hours',
  personal: 'Personal',
};

/** Solid accent color per category — used for the left border stripe on
 * engagement cards and category dots, mirroring the web app's palette
 * (blue/violet rather than red — red is reserved for actual errors and
 * destructive actions, not neutral category labels like "meeting"). */
export const CATEGORY_COLORS: Record<EngagementCategory, string> = {
  meeting: '#3b82f6',
  interview: '#8b5cf6',
  office_hours: '#f97316',
  personal: '#0ea5e9',
};

export const CATEGORY_OPTIONS: EngagementCategory[] = ['meeting', 'interview', 'office_hours', 'personal'];
