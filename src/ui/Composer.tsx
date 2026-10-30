import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from './Press';
import { FadeIn } from './FadeIn';
import { useApp } from './hooks';
import { colors } from './theme';
import { Icon } from './Icon';
import { ms } from './motion';
import { clearAttachment, pickImage, sendMessage, stopGenerating, toggleVoice, warmUp } from '../app/controller';

type Kind = 'mic' | 'send' | 'stop';
const INDEX: Record<Kind, number> = { mic: 0, send: 1, stop: 2 };
const LABEL: Record<Kind, string> = { mic: 'Start live voice', send: 'Send', stop: 'Stop' };

/**
 * One round button that turns into whatever is useful right now: mic (nothing typed), send (something typed)
 * or stop (a reply is being written). The three faces cross-fade and the button pops when it changes.
 */
function ActionButton({ kind, onPress }: { kind: Kind; onPress: () => void }) {
  const m = useRef(new Animated.Value(INDEX[kind])).current;
  const pop = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    Animated.timing(m, { toValue: INDEX[kind], duration: ms(150), useNativeDriver: true }).start();
    if (first.current) {
      first.current = false;
      return;
    }
    pop.setValue(0.78);
    Animated.spring(pop, { toValue: 1, speed: 28, bounciness: 12, useNativeDriver: true }).start();
  }, [kind, m, pop]);

  const face = (i: number) => ({ opacity: m.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [0, 1, 0], extrapolate: 'clamp' as const }) });

  return (
    <Animated.View style={{ transform: [{ scale: pop }] }}>
      <Press style={styles.action} onPress={onPress} haptic={kind === 'send' ? 'medium' : 'light'} accessibilityLabel={LABEL[kind]}>
        <Animated.View style={[styles.face, { backgroundColor: colors.accentDim }, face(0)]}>
          <Icon name="audio" size={24} />
        </Animated.View>
        <Animated.View style={[styles.face, { backgroundColor: colors.accent }, face(1)]}>
          <Icon name="send" size={22} color={colors.onAccent} />
        </Animated.View>
        <Animated.View style={[styles.face, { backgroundColor: colors.danger }, face(2)]}>
          <View style={styles.stopSquare} />
        </Animated.View>
      </Press>
    </Animated.View>
  );
}

export function Composer() {
  const [text, setText] = useState('');
  const attachment = useApp((s) => s.attachment);
  const generating = useApp((s) => s.generating);
  const queued = useApp((s) => s.queued);

  const canSend = text.trim().length > 0 || attachment != null;
  // while a reply streams, typing something turns the button into Send (it queues the message); empty = Stop
  const typed = text.trim().length > 0;
  const kind: Kind = generating ? (typed ? 'send' : 'stop') : canSend ? 'send' : 'mic';

  const send = () => {
    const t = text;
    setText(''); // clear first: the box empties on touch, not when the model answers
    void sendMessage(t);
  };

  const attach = () =>
    Alert.alert('Attach an image', undefined, [
      { text: 'Photo library', onPress: () => void pickImage('library') },
      { text: 'Camera', onPress: () => void pickImage('camera') },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <View style={styles.wrap}>
      {attachment ? (
        <FadeIn y={6} duration={150}>
          <View style={styles.preview}>
            <Image source={{ uri: attachment.uri }} style={styles.thumb} />
            <Text style={styles.previewText}>Image attached — ask about it</Text>
            <Press onPress={clearAttachment} hitSlop={10} accessibilityLabel="Remove image" haptic={false}>
              <Text style={styles.remove}>✕</Text>
            </Press>
          </View>
        </FadeIn>
      ) : null}

      {queued > 0 ? (
        <FadeIn y={4} duration={140}>
          <Text style={styles.queued}>{queued} message{queued > 1 ? 's' : ''} queued, sent when the reply is done</Text>
        </FadeIn>
      ) : null}

      <View style={styles.row}>
        <Press style={styles.iconBtn} onPress={attach} accessibilityLabel="Attach image" disabled={generating}>
          <Icon name="gallery" size={24} />
        </Press>

        {/* never switched to read-only while a reply streams: that made Android hide the keyboard on every send */}
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          onFocus={warmUp}
          placeholder="Message"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={8000}
        />

        <ActionButton
          kind={kind}
          onPress={() => {
            if (kind === 'stop') stopGenerating();
            else if (kind === 'send') send();
            else void toggleVoice();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderRadius: 22,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
  },
  action: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
  face: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 14, height: 14, borderRadius: 3, backgroundColor: colors.text },
  queued: { color: colors.muted, fontSize: 12, textAlign: 'center', marginBottom: 6 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, backgroundColor: colors.surface, borderRadius: 14, padding: 8 },
  thumb: { width: 44, height: 44, borderRadius: 8 },
  previewText: { flex: 1, color: colors.muted, fontSize: 13 },
  remove: { color: colors.muted, fontSize: 18, paddingHorizontal: 6 },
});
