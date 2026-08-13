import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const colors = Colors.light;

  return (
    <NativeTabs
      backgroundColor={colors.background}
      // Without this, iOS's "scroll edge" (resting/unscrolled) appearance
      // ignores backgroundColor entirely and falls back to a translucent
      // system material that tracks the OS light/dark setting — the bar only
      // picked up our color once the screen was scrolled. This pins it.
      disableTransparentOnScrollEdge
      blurEffect="none"
      indicatorColor={colors.backgroundElement}
      // iconColor has no default of its own — left unset, iOS keeps the
      // system tint and Android falls back to Material You's dynamic
      // (system-theme-following) color, both independent of Colors.light.
      iconColor={{ default: colors.textSecondary, selected: colors.text }}
      labelStyle={{ default: { color: colors.textSecondary }, selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'calendar', selected: 'calendar' }} md="calendar_month" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="engagements">
        <NativeTabs.Trigger.Label>Engagements</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'list.bullet', selected: 'list.bullet' }} md="checklist" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="chat">
        <NativeTabs.Trigger.Label>Chat</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'message', selected: 'message.fill' }} md="chat" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
