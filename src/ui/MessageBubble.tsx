import React, { memo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Press as Pressable } from './Press';
import type { ChatMsg } from '../state/app';
import { colors } from './theme';
import { FadeIn } from './FadeIn';
import { TypingDots } from './TypingDots';
import { copyText, regenerate } from '../app/controller';

function MessageBubbleImpl({ msg, animateIn = false, isLast = false }: { msg: ChatMsg; animateIn?: boolean; isLast?: boolean }) {
  const mine = msg.role === 'user';
  const [showThought, setShowThought] = useState(false);

  const canRetry = isLast && !mine && !msg.streaming && !!msg.text;
  return (
    <FadeIn enabled={animateIn} y={12} style={[styles.wrap, mine ? styles.wrapMine : styles.wrapTheirs]}>
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
          <TypingDots />
        ) : null}

        {msg.streaming && msg.text ? <Text style={styles.cursor}>▍</Text> : null}
        {msg.interrupted ? <Text style={styles.badge}>⏹ interrupted</Text> : null}

        {!mine && !msg.streaming && msg.text ? (
          <View style={styles.actions}>
            <Pressable style={styles.action} onPress={() => void copyText(msg.text)} accessibilityLabel="Copy reply" pressScale={0.9}>
              <Text style={styles.actionText}>Copy</Text>
            </Pressable>
            {canRetry ? (
              <Pressable style={styles.action} onPress={() => void regenerate()} accessibilityLabel="Try again" pressScale={0.9}>
                <Text style={styles.actionText}>Try again</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </FadeIn>
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
  actions: { flexDirection: 'row', gap: 6, marginTop: 8 },
  action: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.surfaceHi },
  actionText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  cursor: { color: colors.accent, fontSize: 16 },
  badge: { color: colors.muted, fontSize: 11, marginTop: 4 },
  thought: { color: colors.muted, fontSize: 13, fontStyle: 'italic', marginBottom: 6 },
});
