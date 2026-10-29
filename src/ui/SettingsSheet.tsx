import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Sheet } from './Sheet';
import { useApp } from './hooks';
import { colors, shared } from './theme';
import { openSheet, restartServer, setSettings } from '../app/controller';
import type { Settings } from '../state/settings';

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Stepper({ value, step, min, max, format, onChange }: { value: number; step: number; min: number; max: number; format?: (v: number) => string; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  return (
    <View style={styles.stepper}>
      <Pressable style={styles.stepBtn} onPress={() => onChange(clamp(value - step))}>
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{format ? format(value) : String(value)}</Text>
      <Pressable style={styles.stepBtn} onPress={() => onChange(clamp(value + step))}>
        <Text style={styles.stepText}>＋</Text>
      </Pressable>
    </View>
  );
}

export function SettingsSheet() {
  const visible = useApp((s) => s.sheet === 'settings');
  const s = useApp((st) => st.settings);
  const set = (p: Partial<Settings>) => setSettings(p);

  return (
    <Sheet visible={visible} title="Settings" onClose={() => openSheet('none')}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.section}>Live voice</Text>
        <Row title="Interrupt by speaking" hint="Talk over the assistant to cut it off">
          <Switch value={s.bargeIn} onValueChange={(v) => set({ bargeIn: v })} />
        </Row>
        <Row title="Echo cancellation (call mode)" hint="Lets the speaker and mic coexist. Turn off if audio is too quiet.">
          <Switch value={s.callMode} onValueChange={(v) => set({ callMode: v })} />
        </Row>
        <Row title="Show captions while it speaks" hint="Off = audio only">
          <Switch value={s.speechReply === 'text+audio'} onValueChange={(v) => set({ speechReply: v ? 'text+audio' : 'audio' })} />
        </Row>
        <Row title="Mic sensitivity" hint="Higher picks up quiet speech, lower ignores noise">
          <Stepper value={s.vadSensitivity} step={0.1} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ vadSensitivity: v })} />
        </Row>
        <Row title="Wait after you stop" hint="Silence before it answers">
          <Stepper value={s.silenceMs} step={100} min={300} max={2000} format={(v) => `${v} ms`} onChange={(v) => set({ silenceMs: v })} />
        </Row>
        <Text style={styles.label}>Voice persona</Text>
        <TextInput style={styles.input} value={s.voicePrompt} onChangeText={(t) => set({ voicePrompt: t })} multiline placeholderTextColor={colors.muted} />

        <Text style={styles.section}>Chat</Text>
        <Text style={styles.label}>System prompt</Text>
        <TextInput style={styles.input} value={s.systemPrompt} onChangeText={(t) => set({ systemPrompt: t })} multiline placeholderTextColor={colors.muted} />

        <Text style={styles.section}>Model engine</Text>
        <Row title="Thinking mode" hint="Lets the model reason before answering (slower). Applies after restart.">
          <Switch value={s.thinking} onValueChange={(v) => set({ thinking: v })} />
        </Row>
        <Row title="CPU threads" hint="0 = automatic. Applies after restart.">
          <Stepper value={s.threads} step={1} min={0} max={8} onChange={(v) => set({ threads: v })} />
        </Row>
        <Row title="Context size" hint="Shared by chat and voice. Applies after restart.">
          <Stepper value={s.contextSize} step={4096} min={4096} max={65536} format={(v) => `${v / 1024}k`} onChange={(v) => set({ contextSize: v })} />
        </Row>
        <Row title="Free memory when idle" hint="Stop the model after N minutes in the background (0 = never)">
          <Stepper value={s.idleStopMinutes} step={1} min={0} max={60} format={(v) => (v === 0 ? 'never' : `${v} min`)} onChange={(v) => set({ idleStopMinutes: v })} />
        </Row>
        <Pressable style={[shared.btn, shared.btnPrimary, { marginTop: 14 }]} onPress={() => void restartServer()}>
          <Text style={[shared.btnText, shared.btnTextPrimary]}>Apply &amp; restart engine</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  section: { color: colors.accent, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 22, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowTitle: { color: colors.text, fontSize: 15 },
  rowHint: { color: colors.muted, fontSize: 12, marginTop: 2, lineHeight: 16 },
  label: { color: colors.muted, fontSize: 13, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: colors.surface, color: colors.text, borderRadius: 12, padding: 12, fontSize: 14, minHeight: 64, textAlignVertical: 'top' },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12 },
  stepBtn: { paddingHorizontal: 14, paddingVertical: 8 },
  stepText: { color: colors.accent, fontSize: 18, fontWeight: '700' },
  stepValue: { color: colors.text, fontSize: 14, minWidth: 56, textAlign: 'center' },
});
