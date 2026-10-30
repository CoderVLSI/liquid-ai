import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { Press } from './Press';
import { Mascot } from './Mascot';
import { motion } from './motion';
import { getBuddy } from '../buddies/registry';
import { choosePose } from '../buddies/mood';
import type { Mood, Pose } from '../buddies/mood';
import { tap } from '../lib/haptics';

const loop = (v: Animated.Value, to: number, half: number, easing = Easing.inOut(Easing.sin)) =>
  Animated.loop(
    Animated.sequence([
      Animated.timing(v, { toValue: to, duration: half, easing, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: half, easing, useNativeDriver: true }),
    ]),
  );

/** The built-in orb only knows four moods. */
const orbMood = (m: Mood) => (m === 'asleep' ? 'asleep' : m === 'working' ? 'working' : m === 'waiting' ? 'waiting' : 'idle');

/**
 * A buddy brought to life: it swaps between its expression poses (blinks, opens its mouth to talk, thinks while the
 * model works) and moves the picture itself: breathing, bobbing, wobbling while it works, hopping when it needs you,
 * a happy bounce when you tap it. Everything runs on the native thread and stops when animations are off.
 */
export function BuddyView({ buddyId, mood, size = 140, tappable = true }: { buddyId: string; mood: Mood; size?: number; tappable?: boolean }) {
  const buddy = useMemo(() => getBuddy(buddyId), [buddyId]);
  if (buddy.id === 'orb') return <Mascot mood={orbMood(mood)} size={size / 1.3} />;
  return <SpriteBuddy buddyId={buddy.id} mood={mood} size={size} tappable={tappable} />;
}

function SpriteBuddy({ buddyId, mood: moodProp, size, tappable }: { buddyId: string; mood: Mood; size: number; tappable: boolean }) {
  const buddy = getBuddy(buddyId);
  const [blink, setBlink] = useState(false);
  const [mouth, setMouth] = useState(false);
  const [burst, setBurst] = useState(false);
  const mood: Mood = burst ? 'happy' : moodProp;

  const breathe = useRef(new Animated.Value(0)).current; // 0..1
  const bob = useRef(new Animated.Value(0)).current;
  const wobble = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const squash = useRef(new Animated.Value(0)).current; // the happy bounce: 0 rest, 1 jump
  const zzz = useRef(new Animated.Value(0)).current;

  const has = useCallback((p: Pose) => buddy.poses[p] != null, [buddy]);
  const pose = choosePose(mood, { blink, mouth }, has);

  // breathing + gentle bob, always (unless animations are off)
  useEffect(() => {
    if (motion.reduce) return undefined;
    const slow = mood === 'asleep';
    const a = loop(breathe, 1, slow ? 1800 : 1100);
    const b = loop(bob, 1, slow ? 2200 : 1500);
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [breathe, bob, mood]);

  // mood motion: wobble while working, hop while it needs you, floating z while asleep
  useEffect(() => {
    wobble.setValue(0);
    hop.setValue(0);
    zzz.setValue(0);
    if (motion.reduce) return undefined;
    let a: Animated.CompositeAnimation | null = null;
    if (mood === 'working') a = loop(wobble, 1, 420);
    else if (mood === 'waiting') {
      a = Animated.loop(
        Animated.sequence([
          Animated.timing(hop, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(hop, { toValue: 0, duration: 320, easing: Easing.bounce, useNativeDriver: true }),
          Animated.delay(1000),
        ]),
      );
    } else if (mood === 'asleep') {
      a = Animated.loop(Animated.sequence([Animated.timing(zzz, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true }), Animated.delay(300)]));
    }
    a?.start();
    return () => a?.stop();
  }, [mood, wobble, hop, zzz]);

  // blinking: every few seconds, 120 ms
  useEffect(() => {
    if (motion.reduce || mood === 'asleep' || mood === 'working' || mood === 'happy' || mood === 'sad') return undefined;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        t = setTimeout(() => {
          if (!alive) return;
          setBlink(false);
          schedule();
        }, 120);
      }, 2400 + Math.random() * 2600);
    };
    schedule();
    return () => {
      alive = false;
      clearTimeout(t);
      setBlink(false);
    };
  }, [mood]);

  // talking: the mouth opens and closes at an uneven, speech-like rhythm
  useEffect(() => {
    if (mood !== 'talking') {
      setMouth(false);
      return undefined;
    }
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const flap = (open: boolean) => {
      if (!alive) return;
      setMouth(open);
      t = setTimeout(() => flap(!open), open ? 110 + Math.random() * 130 : 70 + Math.random() * 190);
    };
    flap(true);
    return () => {
      alive = false;
      clearTimeout(t);
      setMouth(false);
    };
  }, [mood]);

  // the happy bounce: squash, jump, land, then back to whatever it was doing
  const celebrate = useCallback(() => {
    if (burst) return;
    setBurst(true);
    tap('light');
    squash.setValue(0);
    Animated.sequence([
      Animated.timing(squash, { toValue: -0.5, duration: motion.reduce ? 0 : 110, useNativeDriver: true }),
      Animated.timing(squash, { toValue: 1, duration: motion.reduce ? 0 : 210, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(squash, { toValue: 0, duration: motion.reduce ? 0 : 320, easing: Easing.bounce, useNativeDriver: true }),
    ]).start(() => setTimeout(() => setBurst(false), 500));
  }, [burst, squash]);

  const translateY = Animated.add(
    Animated.add(
      bob.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.025] }),
      breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.02] }), // keeps the feet planted while it grows
    ),
    Animated.add(hop.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.13] }), squash.interpolate({ inputRange: [-0.5, 0, 1], outputRange: [size * 0.04, 0, -size * 0.22] })),
  );
  const scaleY = Animated.add(
    breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }),
    squash.interpolate({ inputRange: [-0.5, 0, 1], outputRange: [-0.16, 0, 0.1] }),
  );
  const scaleX = Animated.add(
    breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] }),
    squash.interpolate({ inputRange: [-0.5, 0, 1], outputRange: [0.14, 0, -0.06] }),
  );
  const rotate = wobble.interpolate({ inputRange: [0, 1], outputRange: ['-3.5deg', '3.5deg'] });
  const shadowScale = Animated.add(1, Animated.multiply(squash, -0.25));

  const images = useMemo(() => (Object.keys(buddy.poses) as Pose[]).map((p) => ({ p, src: buddy.poses[p]! })), [buddy]);

  const body = (
    <View style={{ width: size, height: size }} accessibilityLabel={`${buddy.name} is ${mood}`}>
      <Animated.View style={[styles.shadow, { width: size * 0.62, bottom: size * 0.02, transform: [{ scaleX: shadowScale }] }]} />
      <Animated.View style={{ width: size, height: size, transform: [{ translateY }, { rotate }, { scaleX }, { scaleY }] }}>
        {images.map(({ p, src }) => (
          <Image key={p} source={src} style={[styles.img, { opacity: p === pose ? 1 : 0 }]} resizeMode="contain" fadeDuration={0} />
        ))}
      </Animated.View>
      {mood === 'asleep' && !motion.reduce ? (
        <Animated.Text
          style={[
            styles.zzz,
            { right: size * 0.08, top: size * 0.12, fontSize: size * 0.16, opacity: zzz.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }), transform: [{ translateY: zzz.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.18] }) }] },
          ]}
        >
          z
        </Animated.Text>
      ) : null}
    </View>
  );

  return tappable ? (
    <Press onPress={celebrate} haptic={false} pressScale={0.97} accessibilityLabel={`${buddy.name}, tap to play`}>
      {body}
    </Press>
  ) : (
    body
  );
}

/** A small still picture of a buddy, for pickers. */
export function BuddyThumb({ buddyId, size = 72 }: { buddyId: string; size?: number }) {
  const buddy = getBuddy(buddyId);
  if (buddy.id === 'orb') return <Mascot mood="asleep" size={size * 0.7} />;
  return <Image source={buddy.poses.idle} style={{ width: size, height: size }} resizeMode="contain" />;
}

const styles = StyleSheet.create({
  img: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  shadow: { position: 'absolute', alignSelf: 'center', height: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.28)' },
  zzz: { position: 'absolute', color: '#C8E6FF', fontWeight: '800' },
});
