import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ChatBubble, type DisplayMessage } from '@/components/chat-bubble';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ApiError, getChatHistory, sendChatMessage } from '@/lib/api';
import { useTheme } from '@/hooks/use-theme';

const SESSION_STORAGE_KEY = 'chat_session_id';

const SUGGESTIONS = [
  'Schedule a call with Sam tomorrow at 3pm',
  "What's free this week?",
  'Am I available Friday at 2pm EST?',
];

export default function ChatScreen() {
  const theme = useTheme();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [isHydrating, setIsHydrating] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<DisplayMessage>>(null);

  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
      if (!stored) {
        if (!cancelled) setIsHydrating(false);
        return;
      }
      try {
        const history = await getChatHistory(stored);
        if (cancelled) return;
        setSessionId(history.session_id);
        setMessages(
          history.messages.map((message) => ({
            role: message.role,
            content: message.content,
            actions: message.actions,
            lookedUpEngagements: message.looked_up_engagements,
          })),
        );
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 404) {
          await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
        } else {
          setError(caught instanceof ApiError ? caught.message : 'Failed to load conversation history.');
        }
      } finally {
        if (!cancelled) setIsHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages, isSending]);

  async function handleSend(overrideText?: string) {
    const trimmed = (overrideText ?? input).trim();
    if (!trimmed || isSending) return;

    setMessages((previous) => [...previous, { role: 'user', content: trimmed }]);
    setInput('');
    setIsSending(true);
    setError(null);

    try {
      const response = await sendChatMessage({ session_id: sessionId, message: trimmed, timezone });
      if (response.session_id !== sessionId) {
        setSessionId(response.session_id);
        await AsyncStorage.setItem(SESSION_STORAGE_KEY, response.session_id);
      }
      setMessages((previous) => [
        ...previous,
        {
          role: 'assistant',
          content: response.reply,
          actions: response.actions,
          conflict: response.conflict,
          lookedUpEngagements: response.looked_up_engagements,
        },
      ]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong sending that message.');
    } finally {
      setIsSending(false);
    }
  }

  async function handleNewChat() {
    await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
    setSessionId(null);
    setMessages([]);
    setError(null);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <View>
            <ThemedText type="title" style={styles.title}>
              Chat
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tell it what to schedule, move, or cancel.
            </ThemedText>
          </View>
          <Pressable onPress={handleNewChat} disabled={messages.length === 0} hitSlop={10}>
            <ThemedText
              type="small"
              style={{ color: messages.length === 0 ? theme.textSecondary : theme.tint, fontWeight: '600' }}>
              New chat
            </ThemedText>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={styles.flexOne}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
          {isHydrating ? (
            <View style={styles.centered}>
              <ActivityIndicator color={theme.tint} />
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.tint }]}>
                <Icon name="chat" color="#ffffff" size={28} />
              </View>
              <ThemedText type="smallBold" style={styles.centerText}>
                What do you want to schedule?
              </ThemedText>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((suggestion) => (
                  <Pressable
                    key={suggestion}
                    onPress={() => handleSend(suggestion)}
                    style={[styles.suggestionChip, { borderColor: theme.border }]}>
                    <ThemedText type="small">{suggestion}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(_item, index) => String(index)}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => <ChatBubble message={item} />}
              ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
              ListFooterComponent={
                isSending ? (
                  <View style={[styles.typingBubble, { backgroundColor: theme.backgroundElement }]}>
                    <ActivityIndicator size="small" color={theme.tint} />
                  </View>
                ) : null
              }
            />
          )}

          {error && (
            <View style={[styles.errorBanner, { backgroundColor: theme.dangerBackground }]}>
              <ThemedText type="small" style={{ color: theme.danger }}>
                {error}
              </ThemedText>
            </View>
          )}

          <View style={[styles.inputRow, { borderTopColor: theme.border }]}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Message the assistant…"
              placeholderTextColor={theme.textSecondary}
              editable={!isSending}
              multiline
              style={[styles.textInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              onSubmitEditing={() => handleSend()}
            />
            <Pressable
              onPress={() => handleSend()}
              disabled={isSending || input.trim().length === 0}
              style={[styles.sendButton, { backgroundColor: theme.tint, opacity: isSending || !input.trim() ? 0.5 : 1 }]}>
              {isSending ? <ActivityIndicator color="#ffffff" size="small" /> : <Icon name="send" color="#ffffff" size={18} />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
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
  flexOne: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerText: {
    textAlign: 'center',
  },
  suggestions: {
    gap: Spacing.two,
    alignItems: 'center',
  },
  suggestionChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.five,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  typingBubble: {
    alignSelf: 'flex-start',
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  errorBanner: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  textInput: {
    flex: 1,
    maxHeight: 120,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 15,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
