import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAgents, useApp } from './hooks';
import { colors } from './theme';
import { setMode } from '../app/controller';

/** The Chat | Agent switch at the top of the screen. */
export function ModeToggle() {
  const mode = useApp((s) => s.mode);
  const attention = useAgents((s) => s.tasks.filter((t) => t.status === 'waiting').length);
  const busy = useAgents((s) => s.tasks.some((t) => t.status === 'running' || t.status === 'queued' || t.status === 'blocked'));

  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        <Pressable style={[styles.seg, mode === 'chat' && styles.segOn]} onPress={() => setMode('chat')} accessibilityLabel="Chat mode">
          <Text style={[styles.label, mode === 'chat' && styles.labelOn]}>Chat</Text>
        </Pressable>
        <Pressable style={[styles.seg, mode === 'agent' && styles.segOn]} onPress={() => setMode('agent')} accessibilityLabel="Agent mode">
          <Text style={[styles.label, mode === 'agent' && styles.labelOn]}>Agent</Text>
          {attention > 0 ? (
            <View style={[styles.badge, { backgroundColor: colors.warn }]}>
              <Text style={styles.badgeText}>{attention}</Text>
            </View>
          ) : busy && mode !== 'agent' ? (
            <View style={[styles.dot, { backgroundColor: colors.accent }]} />
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingBottom: 6 },
  track: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 20, padding: 3, borderWidth: 1, borderColor: colors.border },
  seg: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 104, paddingVertical: 8, borderRadius: 17 },
  segOn: { backgroundColor: colors.accentDim },
  label: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  labelOn: { color: colors.accent },
  badge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: colors.onAccent, fontSize: 11, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
