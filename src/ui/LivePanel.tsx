import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from './hooks';
import { colors } from './theme';
import { Icon } from './Icon';
import { useReduceMotion } from './useReduceMotion';
import { interruptAssistant, setMuted, stopVoice } from '../app/controller';

const orb = require('../../assets/art/orb.png');

const LABEL: Record<string, string> = {
  off: '',
  connecting: 'Connecting…',
  listening: 'Listening',
  hearing: 'Hearing you',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  ended: 'Ended',
  error: 'Error',
};

const GLOW: Record<string, string> = {
  hearing: colors.accent,
  thinking: colors.violet,
  speaking: colors.blue,
};

export function LivePanel() {
  const voice = useApp((s) => s.voice);
  const callMode = useApp((s) => s.settings.callMode);
  const level = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const reduce = useReduceMotion();

  // The orb swells with your voice while you talk, and breathes while the model thinks or speaks.
  useEffect(() => {
    if (voice.state === 'hearing' || voice.state === 'listening') {
      const target = 1 + Math.min(0.35, voice.level * 5);
      Animated.timing(level, { toValue: target, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    }
  }, [voice.level, voice.state, level]);

  useEffect(() => {
    if (!reduce && (voice.state === 'thinking' || voice.state === 'speaking')) {
      const half = voice.state === 'speaking' ? 420 : 750;
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: half, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0);
    return undefined;
  }, [voice.state, pulse, reduce]);

  const breathe = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const animated = voice.state === 'thinking' || voice.state === 'speaking';
  const busy = animated;
  const glow = GLOW[voice.state];

  return (
    <View style={styles.wrap}>
      <View style={styles.orbArea}>
        {glow ? <Animated.View style={[styles.glow, { backgroundColor: glow, transform: [{ scale: animated ? breathe : level }] }]} /> : null}
        <Animated.Image
          source={orb}
          style={[styles.orb, { opacity: voice.muted ? 0.35 : 1, transform: [{ scale: animated ? breathe : level }] }]}
          resizeMode="contain"
        />
      </View>
      <Text style={styles.label}>{voice.muted ? 'Muted' : LABEL[voice.state] ?? voice.state}</Text>
      {!callMode ? <Text style={styles.hint}>Tip: use headphones so it does not hear itself</Text> : null}

      <View style={styles.buttons}>
        <Pressable style={[styles.btn, voice.muted && styles.btnOn]} onPress={() => setMuted(!voice.muted)} accessibilityLabel="Mute">
          <Icon name="audio" size={22} color={voice.muted ? colors.muted : colors.accent} />
          <Text style={styles.btnLabel}>{voice.muted ? 'Unmute' : 'Mute'}</Text>
        </Pressable>

        <Pressable style={[styles.btn, !busy && styles.btnOff]} onPress={interruptAssistant} disabled={!busy} accessibilityLabel="Interrupt">
          <Icon name="bolt" size={22} color={colors.accent} />
          <Text style={styles.btnLabel}>Interrupt</Text>
        </Pressable>

        <Pressable style={[styles.btn, styles.end]} onPress={() => void stopVoice()} accessibilityLabel="End voice">
          <Icon name="plus" size={22} color={colors.danger} style={{ transform: [{ rotate: '45deg' }] }} />
          <Text style={styles.btnLabel}>End</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 6, paddingBottom: 14, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
  orbArea: { height: 150, width: 150, justifyContent: 'center', alignItems: 'center' },
  glow: { position: 'absolute', width: 96, height: 96, borderRadius: 48, opacity: 0.28 },
  orb: { width: 140, height: 140 },
  label: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 0 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 4 },
  buttons: { flexDirection: 'row', gap: 14, marginTop: 12 },
  btn: { width: 88, paddingVertical: 10, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', gap: 4 },
  btnOn: { backgroundColor: colors.accentDim },
  btnOff: { opacity: 0.4 },
  end: { backgroundColor: colors.dangerDim },
  btnLabel: { color: colors.muted, fontSize: 12 },
});
