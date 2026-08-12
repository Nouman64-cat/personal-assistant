import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';

/**
 * Semantic icon names mapped to their per-platform symbol — SF Symbols on
 * iOS, Material Symbols on Android/web (both verified against the actual
 * bundled `expo-symbols` symbol sets, not guessed from memory — see the
 * mobile AGENTS.md note about Expo's API surface having moved recently).
 */
const ICONS = {
  calendar: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  engagements: { ios: 'list.bullet', android: 'checklist', web: 'checklist' },
  chat: { ios: 'message.fill', android: 'chat', web: 'chat' },
  settings: { ios: 'gearshape.fill', android: 'settings', web: 'settings' },
  add: { ios: 'plus', android: 'add', web: 'add' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  mic: { ios: 'mic.fill', android: 'mic', web: 'mic' },
  send: { ios: 'paperplane.fill', android: 'send', web: 'send' },
  trash: { ios: 'trash', android: 'delete', web: 'delete' },
  clock: { ios: 'clock', android: 'schedule', web: 'schedule' },
  chevronLeft: { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  edit: { ios: 'square.and.pencil', android: 'edit', web: 'edit' },
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps extends Omit<SymbolViewProps, 'name'> {
  name: IconName;
  size?: number;
  color?: ColorValue;
}

export function Icon({ name, size = 20, color, ...rest }: IconProps) {
  return <SymbolView name={ICONS[name]} size={size} tintColor={color} {...rest} />;
}
