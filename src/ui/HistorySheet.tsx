import React from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { Sheet } from './Sheet';
import { Press } from './Press';
import { FadeIn } from './FadeIn';
import { useApp } from './hooks';
import { ago } from './AgentsSheet';
import { colors } from './theme';
import { clearHistory, deleteChat, openChat, openSheet } from '../app/controller';
import type { SavedChat } from '../chat/saved';

function Row({ chat, index }: { chat: SavedChat; index: number }) {
  const last = [...chat.messages].reverse().find((m) => m.role === 'assistant' && m.text.trim());
  return (
    <FadeIn delay={Math.min(index, 8) * 40} y={8}>
      <View style={styles.row}>
        <Press style={styles.main} onPress={() => openChat(chat.id)} pressScale={0.98} accessibilityLabel={`Open chat ${chat.title}`}>
          <Text style={styles.title} numberOfLines={1}>{chat.title}</Text>
          {last ? <Text style={styles.preview} numberOfLines={2}>{last.text.trim()}</Text> : null}
          <Text style={styles.meta}>{ago(chat.t)} · {chat.messages.length} messages</Text>
        </Press>
        <Press style={styles.del} onPress={() => deleteChat(chat.id)} hitSlop={8} haptic="light" accessibilityLabel={`Delete chat ${chat.title}`}>
          <Text style={styles.delText}>✕</Text>
        </Press>
      </View>
    </FadeIn>
  );
}

export function HistorySheet() {
  const visible = useApp((s) => s.sheet === 'history');
  const chats = useApp((s) => s.chats);
  return (
    <Sheet
      visible={visible}
      title="History"
      onClose={() => openSheet('none')}
      right={
        chats.length ? (
          <Press onPress={() => Alert.alert('Delete all past chats?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete all', style: 'destructive', onPress: clearHistory }])} accessibilityLabel="Delete all history">
            <Text style={styles.clear}>Clear</Text>
          </Press>
        ) : null
      }
    >
      <FlatList
        data={chats}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 14, paddingBottom: 40, flexGrow: 1 }}
        renderItem={({ item, index }) => <Row chat={item} index={index} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No past chats yet</Text>
            <Text style={styles.emptyText}>Past chats show up here. Tap + to start a new one and the current chat is kept.</Text>
          </View>
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginBottom: 10 },
  main: { flex: 1, backgroundColor: colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  preview: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  meta: { color: colors.muted, fontSize: 11, marginTop: 6 },
  del: { width: 44, borderRadius: 16, backgroundColor: colors.dangerDim, alignItems: 'center', justifyContent: 'center' },
  delText: { color: colors.danger, fontSize: 16, fontWeight: '700' },
  clear: { color: colors.danger, fontSize: 14, fontWeight: '700', paddingHorizontal: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  emptyText: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },
});
