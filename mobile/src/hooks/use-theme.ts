import { Colors } from '@/constants/theme';

/** The app is light-theme-only by design — this is the single place that pins it. */
export function useTheme() {
  return Colors.light;
}
