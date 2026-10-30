import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Press } from './Press';
import { FadeIn } from './FadeIn';
import { useAgents, useApp } from './hooks';
import { colors } from './theme';
import { ms } from './motion';
import { setMode } from '../app/controller';

const PAD = 4; // 1 px border + 3 px padding on each side

/** The Chat | Agent switch at the top of the screen: a pill that slides between the two. */
export function ModeToggle() {
  const mode = useApp((s) => s.mode);
  const attention = useAgents((s) => s.tasks.filter((t) => t.status === 'waiting').length);
  const busy = useAgents((s) => s.tasks.some((t) => t.status === 'running' || t.status === 'queued' || t.status === 'blocked'));
  const [width, setWidth] = useState(0);
  const pos = useRef(new Animated.Value(mode === 'agent' ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(pos, { toValue: mode === 'agent' ? 1 : 0, duration: ms(180), easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [mode, pos]);

  const seg = Math.max(0, (width - PAD * 2) / 2);

  return (
    <View style={styles.wrap}>
      <View style={styles.track} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? <Animated.View pointerEvents="none" style={[styles.pill, { width: seg, transform: [{ translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, seg] }) }] }]} /> : null}
        <Press style={styles.seg} onPress={() => setMode('chat')} pressScale={0.96} accessibilityLabel="Chat mode">
          <Text style={[styles.label, mode === 'chat' && styles.labelOn]}>Chat</Text>
        </Press>
        <Press style={styles.seg} onPress={() => setMode('agent')} pressScale={0.96} accessibilityLabel="Agent mode">
          <Text style={[styles.label, mode === 'agent' && styles.labelOn]}>Agent</Text>
          {attention > 0 ? (
            <FadeIn y={0} duration={140}>
              <View style={[styles.badge, { backgroundColor: colors.warn }]}>
                <Text style={styles.badgeText}>{attention}</Text>
              </View>
            </FadeIn>
          ) : busy && mode !== 'agent' ? (
            <View style={[styles.dot, { backgroundColor: colors.accent }]} />
          ) : null}
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingBottom: 6 },
  track: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 20, padding: 3, borderWidth: 1, borderColor: colors.border },
  pill: { position: 'absolute', left: PAD - 1, top: PAD - 1, bottom: PAD - 1, borderRadius: 17, backgroundColor: colors.accentDim },
  seg: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 104, paddingVertical: 8, borderRadius: 17 },
  label: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  labelOn: { color: colors.accent },
  badge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: colors.onAccent, fontSize: 11, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
