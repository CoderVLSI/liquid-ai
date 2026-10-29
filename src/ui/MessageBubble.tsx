import React, { memo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatMsg } from '../state/app';
import { colors } from './theme';

function MessageBubbleImpl({ msg }: { msg: ChatMsg }) {
  const mine = msg.role === 'user';
  const [showThought, setShowThought] = useState(false);

  return (
    <View style={[styles.wrap, mine ? styles.wrapMine : styles.wrapTheirs]}>
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs, msg.error && styles.error]}>
        {msg.imageUri ? <Image source={{ uri: msg.imageUri }} style={styles.image} resizeMode="cover" /> : null}

        {msg.reasoning ? (
          <Pressable onPress={() => setShowThought((v) => !v)}>
            <Text style={styles.thought}>
              {showThought ? msg.reasoning : `💭 Thought (${msg.reasoning.length} chars) — tap to expand`}
            </Text>
          </Pressable>
        ) : null}

        {msg.text ? (
          <Text style={[styles.text, mine && styles.textMine, msg.voice && styles.voice]} selectable>
            {msg.text}
          </Text>
        ) : msg.streaming ? (
          <View style={styles.thinking}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.thinkingText}>thinking…</Text>
          </View>
        ) : null}

        {msg.streaming && msg.text ? <Text style={styles.cursor}>▍</Text> : null}
        {msg.interrupted ? <Text style={styles.badge}>⏹ interrupted</Text> : null}
      </View>
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingVertical: 4, flexDirection: 'row' },
  wrapMine: { justifyContent: 'flex-end' },
  wrapTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '86%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  mine: { backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.border },
  error: { backgroundColor: colors.dangerDim, borderColor: colors.danger },
  text: { color: colors.text, fontSize: 16, lineHeight: 22 },
  textMine: { color: colors.onAccent },
  voice: { fontStyle: 'italic' },
  image: { width: 220, height: 160, borderRadius: 12, marginBottom: 8, backgroundColor: colors.surfaceHi },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinkingText: { color: colors.muted, fontSize: 14 },
  cursor: { color: colors.accent, fontSize: 16 },
  badge: { color: colors.muted, fontSize: 11, marginTop: 4 },
  thought: { color: colors.muted, fontSize: 13, fontStyle: 'italic', marginBottom: 6 },
});
