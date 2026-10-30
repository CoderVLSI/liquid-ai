import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from './theme';
import { useReduceMotion } from './useReduceMotion';

const orb = require('../../assets/art/orb.png');

export type MascotMood = 'asleep' | 'idle' | 'working' | 'waiting';

const GLOW: Record<MascotMood, string> = {
  asleep: colors.muted,
  idle: colors.accent,
  working: colors.violet,
  waiting: colors.warn,
};

/**
 * Pocket, the agent's face: the aurora orb with eyes. It floats when idle, pulses while working,
 * hops when it needs a decision and closes its eyes when no model is loaded.
 */
export function Mascot({ mood, size = 120 }: { mood: MascotMood; size?: number }) {
  const float = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const look = useRef(new Animated.Value(0)).current;
  const reduce = useReduceMotion();

  // gentle floating, always (unless the user turned animations off)
  useEffect(() => {
    if (reduce) {
      float.setValue(0.5);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float, reduce]);

  // mood-specific motion
  useEffect(() => {
    pulse.setValue(0);
    hop.setValue(0);
    look.setValue(0);
    if (reduce) return undefined;
    let loop: Animated.CompositeAnimation | null = null;
    if (mood === 'working') {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
    } else if (mood === 'waiting') {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(hop, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(hop, { toValue: 0, duration: 320, easing: Easing.bounce, useNativeDriver: true }),
          Animated.delay(900),
        ]),
      );
    }
    loop?.start();
    // eyes glance around while it works
    let lookLoop: Animated.CompositeAnimation | null = null;
    if (mood === 'working') {
      lookLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(look, { toValue: 1, duration: 700, useNativeDriver: true }),
          Animated.delay(500),
          Animated.timing(look, { toValue: -1, duration: 900, useNativeDriver: true }),
          Animated.delay(500),
        ]),
      );
      lookLoop.start();
    }
    return () => {
      loop?.stop();
      lookLoop?.stop();
    };
  }, [mood, pulse, hop, look, reduce]);

  // blinking
  useEffect(() => {
    if (mood === 'asleep') {
      blink.setValue(0.08);
      return undefined;
    }
    blink.setValue(1);
    if (reduce) return undefined;
    const t = setInterval(() => {
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.08, duration: 80, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 120, useNativeDriver: true }),
      ]).start();
    }, 3300);
    return () => clearInterval(t);
  }, [mood, blink, reduce]);

  const translateY = Animated.add(
    float.interpolate({ inputRange: [0, 1], outputRange: [3, -5] }),
    hop.interpolate({ inputRange: [0, 1], outputRange: [0, -16] }),
  );
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.5] });
  const pupilX = look.interpolate({ inputRange: [-1, 1], outputRange: [-size * 0.025, size * 0.025] });

  const eyeW = size * 0.13;
  const eyeH = size * (mood === 'waiting' ? 0.22 : 0.17);

  const eye = (key: string) => (
    <Animated.View key={key} style={[styles.eye, { width: eyeW, height: eyeH, borderRadius: eyeW / 2, transform: [{ scaleY: blink }] }]}>
      <Animated.View style={[styles.pupil, { width: eyeW * 0.5, height: eyeW * 0.5, borderRadius: eyeW * 0.25, transform: [{ translateX: pupilX }] }]} />
    </Animated.View>
  );

  return (
    <View style={{ width: size * 1.3, height: size * 1.3, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`Pocket is ${mood}`}>
      <Animated.View
        style={[
          styles.glow,
          { width: size * 0.85, height: size * 0.85, borderRadius: size * 0.43, backgroundColor: GLOW[mood], opacity: mood === 'working' ? glowOpacity : 0.22, transform: [{ scale }] },
        ]}
      />
      <Animated.View style={{ transform: [{ translateY }, { scale }] }}>
        <Animated.Image source={orb} style={{ width: size, height: size, opacity: mood === 'asleep' ? 0.5 : 1 }} resizeMode="contain" />
        <View style={[styles.eyes, { top: size * 0.4, gap: size * 0.1 }]}>
          {eye('l')}
          {eye('r')}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute' },
  eyes: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  eye: { backgroundColor: '#f6faff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pupil: { backgroundColor: '#0a1230' },
});
