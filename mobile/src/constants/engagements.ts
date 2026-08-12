import type { EngagementCategory } from '@/lib/types';

export const CATEGORY_LABELS: Record<EngagementCategory, string> = {
  meeting: 'Meeting',
  interview: 'Interview',
  office_hours: 'Office Hours',
  personal: 'Personal',
};

/** Solid accent color per category — used for the left border stripe on
 * engagement cards and category dots, mirroring the web app's palette. */
export const CATEGORY_COLORS: Record<EngagementCategory, string> = {
  meeting: '#ef4444',
  interview: '#f43f5e',
  office_hours: '#f97316',
  personal: '#0ea5e9',
};

export const CATEGORY_OPTIONS: EngagementCategory[] = ['meeting', 'interview', 'office_hours', 'personal'];
