import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, View } from 'react-native';
import { Press } from './Press';
import { BuddyView } from './BuddyView';
import { useApp } from './hooks';
import { useReduceMotion } from './useReduceMotion';
import { colors, shared } from './theme';
import { dismissEvolution } from '../app/controller';
import { getBuddy } from '../buddies/registry';
import type { Form } from '../buddies/evolution';

/** "What? Bloop is evolving!" ... flash ... "Bloop evolved into Bloopa!" */
export function EvolutionOverlay() {
  const ev = useApp((s) => s.evolving);
  const agentName = useApp((s) => s.settings.agentName) || 'Your buddy';
  const reduce = useReduceMotion();
  const [phase, setPhase] = useState<'intro' | 'reveal'>('intro');
  const flash = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!ev) return undefined;
    setPhase('intro');
    flash.setValue(0);
    glow.setValue(0);
    if (reduce) {
      const t = setTimeout(() => setPhase('reveal'), 400);
      return () => clearTimeout(t);
    }
    const shaking = Animated.loop(
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 90, useNativeDriver: true }),
      ]),
    );
    shaking.start();
    Animated.timing(glow, { toValue: 1, duration: 2300, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
    // the glow swells, then a white flash hides the swap
    const t1 = setTimeout(() => Animated.timing(flash, { toValue: 1, duration: 260, useNativeDriver: true }).start(), 2400);
    const t2 = setTimeout(() => {
      shaking.stop();
      setPhase('reveal');
      Animated.timing(flash, { toValue: 0, duration: 700, useNativeDriver: true }).start();
    }, 2700);
    return () => {
      shaking.stop();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [ev, reduce, flash, shake, glow]);

  if (!ev) return null;
  const buddy = getBuddy(ev.buddyId);
  const from: Form = ev.form === 'stage2' ? 'base' : 'stage2';
  const newName = buddy.forms?.[ev.form]?.name ?? `${agentName}, Stage ${ev.form === 'stage2' ? 2 : 3}`;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={dismissEvolution}>
      <View style={styles.root}>
        <Text style={styles.title}>{phase === 'intro' ? `What? ${agentName} is evolving!` : `${agentName} evolved into ${newName}!`}</Text>
        <Animated.View
          style={{ transform: [{ rotate: shake.interpolate({ inputRange: [-1, 1], outputRange: ['-4deg', '4deg'] }) }, { scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, phase === 'intro' ? 1.15 : 1] }) }] }}
          accessibilityLabel={phase === 'intro' ? 'Evolving' : `Evolved into ${newName}`}
        >
          <BuddyView buddyId={ev.buddyId} form={phase === 'intro' ? from : ev.form} mood={phase === 'intro' ? 'working' : 'happy'} size={220} tappable={false} />
        </Animated.View>
        {phase === 'reveal' ? (
          <Press style={[shared.btn, shared.btnPrimary, styles.btn]} onPress={dismissEvolution} accessibilityLabel="Continue">
            <Text style={[shared.btnText, shared.btnTextPrimary]}>Awesome!</Text>
          </Press>
        ) : (
          <View style={styles.btn} />
        )}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash }]} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(8,13,30,0.96)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 24 },
  btn: { marginTop: 28, minWidth: 180, paddingVertical: 14, minHeight: 48 },
});
