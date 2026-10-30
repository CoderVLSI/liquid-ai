import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press as Pressable } from './Press';
import { FadeIn } from './FadeIn';
import { BuddyStatus } from './BuddyStatus';
import { useAgents, useApp, useDownloads } from './hooks';
import { colors, shared } from './theme';
import { Icon } from './Icon';
import { BuddyView } from './BuddyView';
import type { MascotMood } from './Mascot';
import { Chip, IDEAS, TaskCard } from './AgentsSheet';
import { enqueue } from '../agents/runner';
import { openSheet } from '../app/controller';
import { log } from '../lib/log';
import type { AgentTask } from '../agents/types';

const MAIN_AGENT = 'atlas'; // "Pocket": the one agent the user talks to; Scout and Scribe are hidden helpers

function useMood(): { mood: MascotMood; line: string } {
  const tasks = useAgents((s) => s.tasks);
  const states = useDownloads();
  const anyModel = Object.values(states).some((s) => s.status === 'ready');
  return useMemo(() => {
    if (!anyModel) return { mood: 'asleep' as const, line: 'Download a model to wake me up.' };
    const waiting = tasks.filter((t) => t.status === 'waiting').length;
    if (waiting) return { mood: 'waiting' as const, line: waiting > 1 ? `I need your decision on ${waiting} things.` : 'I need your decision.' };
    const active = tasks.filter((t) => !t.parentId && ['running', 'queued', 'blocked'].includes(t.status)).length;
    if (active) return { mood: 'working' as const, line: active > 1 ? `Working on ${active} tasks…` : 'Working on it…' };
    const scheduled = tasks.filter((t) => t.status === 'scheduled').length;
    if (scheduled) return { mood: 'idle' as const, line: `Ready. ${scheduled} task${scheduled > 1 ? 's' : ''} scheduled.` };
    return { mood: 'idle' as const, line: 'Ready when you are.' };
  }, [tasks, anyModel]);
}

function Composer() {
  const name = useApp((s) => s.settings.agentName) || 'Pocket';
  const [goal, setGoal] = useState('');
  const [showWhen, setShowWhen] = useState(false);
  const [delay, setDelay] = useState(0);
  const [every, setEvery] = useState(0);

  const send = () => {
    if (!goal.trim()) return;
    enqueue({ agentId: MAIN_AGENT, goal, runAt: delay ? Date.now() + delay * 60_000 : undefined, everyMinutes: every || undefined });
    setGoal('');
    setDelay(0);
    setEvery(0);
    setShowWhen(false);
  };

  return (
    <View style={styles.composer}>
      {showWhen ? (
        <View style={styles.when}>
          <Text style={styles.whenLabel}>Start</Text>
          <View style={styles.chips}>
            <Chip label="Now" on={delay === 0} onPress={() => setDelay(0)} />
            <Chip label="In 10 min" on={delay === 10} onPress={() => setDelay(10)} />
            <Chip label="In 1 hour" on={delay === 60} onPress={() => setDelay(60)} />
            <Chip label="In 8 hours" on={delay === 480} onPress={() => setDelay(480)} />
          </View>
          <Text style={styles.whenLabel}>Repeat</Text>
          <View style={styles.chips}>
            <Chip label="Once" on={every === 0} onPress={() => setEvery(0)} />
            <Chip label="Hourly" on={every === 60} onPress={() => setEvery(60)} />
            <Chip label="Daily" on={every === 1440} onPress={() => setEvery(1440)} />
          </View>
        </View>
      ) : null}
      <View style={styles.row}>
        <Pressable style={[styles.iconBtn, delay || every ? { backgroundColor: colors.accentDim } : null]} onPress={() => setShowWhen((v) => !v)} accessibilityLabel="Schedule">
          <Icon name="history" size={22} />
        </Pressable>
        <TextInput
          style={styles.input}
          value={goal}
          onChangeText={setGoal}
          placeholder={`Give ${name} a task…`}
          placeholderTextColor={colors.muted}
          multiline
          maxLength={4000}
        />
        <Pressable style={[styles.send, !goal.trim() && { opacity: 0.4 }]} onPress={send} disabled={!goal.trim()} accessibilityLabel="Send task">
          <Icon name="send" size={22} color={colors.onAccent} />
        </Pressable>
      </View>
    </View>
  );
}

/** The Agent half of the app: Pocket the mascot on top, a feed of tasks you gave it, a composer below. */
export function AgentScreen() {
  useEffect(() => {
    log.info('ui', 'AgentScreen mounted');
    return () => log.info('ui', 'AgentScreen unmounted');
  }, []);
  const { mood, line } = useMood();
  const tasks = useAgents((s) => s.tasks);
  const hasModel = useDownloads();
  const anyModel = Object.values(hasModel).some((s) => s.status === 'ready');
  const top = useMemo(() => tasks.filter((t) => !t.parentId), [tasks]);
  const list = useRef<FlatList<AgentTask>>(null);

  useEffect(() => {
    const t = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [top.length]);

  const sub = useApp((s) => s.settings.agentWeb);
  const buddyId = useApp((s) => s.settings.buddy);
  const name = useApp((s) => s.settings.agentName) || 'Pocket';

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.hero}>
        <BuddyView buddyId={buddyId} mood={mood} size={top.length ? 100 : 136} />
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>{line}</Text>
        </View>
        <BuddyStatus compact={top.length > 0} />
        <View style={styles.heroBtns}>
          {!anyModel ? (
            <Pressable style={[shared.btn, shared.btnPrimary]} onPress={() => openSheet('models')}>
              <Text style={[shared.btnText, shared.btnTextPrimary]}>Choose a model</Text>
            </Pressable>
          ) : null}
          <Pressable style={shared.btn} onPress={() => openSheet('agents')} accessibilityLabel="Agent settings">
            <Text style={shared.btnText}>Tools & connections{sub ? '' : ' · offline'}</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        ref={list}
        style={{ flex: 1 }}
        data={top}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 12, paddingBottom: 16 }}
        ListEmptyComponent={
          anyModel ? (
            <View>
              <Text style={styles.ideasTitle}>Try asking {name} to…</Text>
              {IDEAS.map((i, n) => (
                <FadeIn key={i} delay={80 + n * 70}>
                  <Pressable style={styles.idea} onPress={() => enqueue({ agentId: MAIN_AGENT, goal: i })} pressScale={0.97}>
                    <Text style={styles.ideaText}>{i}</Text>
                  </Pressable>
                </FadeIn>
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <FadeIn style={{ marginBottom: 6 }} y={14}>
            <View style={styles.mine}>
              <Text style={styles.mineText} selectable>{item.goal}</Text>
            </View>
            <TaskCard task={item} compact />
          </FadeIn>
        )}
      />
      <Composer />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: 2, paddingBottom: 6 },
  bubble: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 8, marginTop: -6 },
  bubbleText: { color: colors.text, fontSize: 14 },
  heroBtns: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },
  ideasTitle: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  idea: { backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  ideaText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  mine: { alignSelf: 'flex-end', maxWidth: '86%', backgroundColor: colors.accent, borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 6 },
  mineText: { color: colors.onAccent, fontSize: 15, lineHeight: 21 },
  composer: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, backgroundColor: colors.bg },
  when: { backgroundColor: colors.surface, borderRadius: 14, padding: 10, marginBottom: 8, gap: 6 },
  whenLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 22, backgroundColor: colors.surface, color: colors.text, fontSize: 16, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
