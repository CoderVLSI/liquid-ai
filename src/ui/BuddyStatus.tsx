import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from './Press';
import { useApp, useBuddyForm } from './hooks';
import { colors } from './theme';
import { getBuddy } from '../buddies/registry';
import { megaCharges, progress } from '../buddies/evolution';
import { startMega } from '../app/controller';

const FORM_LABEL = { base: 'Stage 1', stage2: 'Stage 2', stage3: 'Stage 3', mega: 'Mega' } as const;

/** Stage, XP bar towards the next evolution, the day streak, and the Mega button when a charge is ready. */
export function BuddyStatus({ compact = false }: { compact?: boolean }) {
  const b = useBuddyForm();
  const used = useApp((s) => s.settings.megaUsed);
  const streak = useApp((s) => s.settings.streak);
  const buddy = getBuddy(b.buddyId);
  const p = progress(b.xp);
  const charges = megaCharges(b.xp, used);
  const minutes = Math.max(0, Math.ceil((b.megaUntil - Date.now()) / 60_000));
  const name = b.form !== 'base' ? buddy.forms?.[b.form]?.name : undefined;

  return (
    <View style={styles.wrap} accessibilityLabel={`Evolution: ${FORM_LABEL[b.form]}, ${b.xp} XP`}>
      <View style={styles.row}>
        <Text style={styles.stage}>{name ? `${name} · ` : ''}{FORM_LABEL[b.form]}</Text>
        {streak > 1 ? <Text style={styles.streak}>🔥 {streak} days</Text> : null}
      </View>
      <View style={styles.bar}>
        <View style={[styles.fill, { width: `${Math.round(p.pct * 100)}%`, backgroundColor: b.megaActive ? '#FFD65A' : colors.accent }]} />
      </View>
      {compact ? null : <Text style={styles.xp}>{p.stage === 3 ? `${b.xp} XP · fully evolved` : `${p.into} / ${p.need} XP to evolve`}</Text>}
      {b.megaActive ? (
        <Text style={styles.mega}>⚡ Mega form · {minutes} min left</Text>
      ) : charges > 0 ? (
        <Press style={styles.megaBtn} onPress={startMega} accessibilityLabel="Mega evolve">
          <Text style={styles.megaBtnText}>⚡ Mega evolve ({charges})</Text>
        </Press>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginTop: 6, minWidth: 190 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stage: { color: colors.text, fontSize: 13, fontWeight: '800' },
  streak: { color: colors.warn, fontSize: 12, fontWeight: '700' },
  bar: { width: 170, height: 6, borderRadius: 3, backgroundColor: colors.border, marginTop: 5, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  xp: { color: colors.muted, fontSize: 11, marginTop: 3 },
  mega: { color: '#FFD65A', fontSize: 12, fontWeight: '800', marginTop: 4 },
  megaBtn: { marginTop: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, backgroundColor: '#3a2f14', borderWidth: 1, borderColor: '#FFD65A' },
  megaBtnText: { color: '#FFD65A', fontSize: 13, fontWeight: '800' },
});
