import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Sheet } from './Sheet';
import { useAgents, useApp } from './hooks';
import { colors, shared } from './theme';
import { addAgent, answerTask, cancelTask, clearFinished, enqueue, notesApi, removeAgent, removeTask, retryTask } from '../agents/runner';
import { openSheet, setSettings } from '../app/controller';
import type { AgentTask, Step, TaskStatus } from '../agents/types';

const STATUS: Record<TaskStatus, { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: colors.muted },
  queued: { label: 'Queued', color: colors.muted },
  running: { label: 'Working…', color: colors.accent },
  waiting: { label: 'Needs you', color: colors.warn },
  blocked: { label: 'Waiting for teammates', color: colors.violet },
  done: { label: 'Done', color: colors.good },
  failed: { label: 'Failed', color: colors.danger },
  cancelled: { label: 'Cancelled', color: colors.muted },
};

const STEP_ICON: Record<Step['kind'], string> = { tool: '🔧', result: '✅', ask: '❓', delegate: '👥', info: '💭', error: '⚠️' };

const IDEAS = [
  'Find the latest news about on-device AI and summarize it in 5 bullets',
  'Plan my day: ask me what I need to do, then save it as a note',
  'Remind me to stretch in 30 minutes',
  'What is 18% of 2,450 plus 75?',
];

function ago(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function inFuture(t?: number): string {
  if (!t) return '';
  const m = Math.max(0, Math.round((t - Date.now()) / 60000));
  return m < 60 ? `in ${m} min` : m < 1440 ? `in ${Math.round(m / 60)} h` : `in ${Math.round(m / 1440)} d`;
}

function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

function NewTask() {
  const agents = useAgents((s) => s.agents);
  const [goal, setGoal] = useState('');
  const [agentId, setAgentId] = useState('atlas');
  const [delay, setDelay] = useState(0);
  const [every, setEvery] = useState(0);

  const start = () => {
    if (!goal.trim()) return;
    enqueue({ agentId, goal, runAt: delay ? Date.now() + delay * 60_000 : undefined, everyMinutes: every || undefined });
    setGoal('');
    setDelay(0);
    setEvery(0);
  };

  return (
    <View style={styles.card}>
      <TextInput
        style={styles.input}
        value={goal}
        onChangeText={setGoal}
        placeholder="Give a teammate a task…"
        placeholderTextColor={colors.muted}
        multiline
      />
      <Text style={styles.label}>Who</Text>
      <View style={styles.row}>
        {agents.map((a) => (
          <Chip key={a.id} label={`${a.emoji} ${a.name}`} on={agentId === a.id} onPress={() => setAgentId(a.id)} />
        ))}
      </View>
      <Text style={styles.label}>When</Text>
      <View style={styles.row}>
        <Chip label="Now" on={delay === 0} onPress={() => setDelay(0)} />
        <Chip label="In 10 min" on={delay === 10} onPress={() => setDelay(10)} />
        <Chip label="In 1 hour" on={delay === 60} onPress={() => setDelay(60)} />
        <Chip label="In 8 hours" on={delay === 480} onPress={() => setDelay(480)} />
      </View>
      <Text style={styles.label}>Repeat</Text>
      <View style={styles.row}>
        <Chip label="Once" on={every === 0} onPress={() => setEvery(0)} />
        <Chip label="Hourly" on={every === 60} onPress={() => setEvery(60)} />
        <Chip label="Daily" on={every === 1440} onPress={() => setEvery(1440)} />
      </View>
      <Pressable style={[shared.btn, shared.btnPrimary, { marginTop: 14 }, !goal.trim() && { opacity: 0.4 }]} onPress={start} disabled={!goal.trim()}>
        <Text style={[shared.btnText, shared.btnTextPrimary]}>Start task</Text>
      </Pressable>
    </View>
  );
}

function TaskCard({ task, depth = 0 }: { task: AgentTask; depth?: number }) {
  const agents = useAgents((s) => s.agents);
  const tasks = useAgents((s) => s.tasks);
  const [open, setOpen] = useState(task.status === 'waiting');
  const [answer, setAnswer] = useState('');
  const agent = agents.find((a) => a.id === task.agentId);
  const st = STATUS[task.status];
  const children = tasks.filter((t) => t.parentId === task.id);
  const question = task.pending.find((p) => p.kind === 'ask')?.question;
  const finished = task.status === 'done' || task.status === 'failed' || task.status === 'cancelled';

  return (
    <View style={{ marginLeft: depth * 14 }}>
      <View style={[styles.card, task.status === 'waiting' && { borderColor: colors.warn }]}>
        <Pressable onPress={() => setOpen((v) => !v)}>
          <View style={styles.head}>
            <Text style={styles.who}>{agent?.emoji ?? '🤖'} {agent?.name ?? 'Agent'}</Text>
            <View style={[styles.pill, { backgroundColor: st.color + '26' }]}>
              <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
            </View>
          </View>
          <Text style={styles.goal} numberOfLines={open ? undefined : 2}>{task.goal}</Text>
          <Text style={styles.meta}>
            {task.status === 'scheduled' ? `Starts ${inFuture(task.runAt)}` : ago(task.updatedAt)}
            {task.everyMinutes ? ` · repeats every ${task.everyMinutes >= 1440 ? 'day' : 'hour'}` : ''}
            {task.stepCount ? ` · ${task.stepCount} model call${task.stepCount > 1 ? 's' : ''}` : ''}
          </Text>
        </Pressable>

        {task.status === 'waiting' && question ? (
          <View style={styles.ask}>
            <Text style={styles.askQ}>❓ {question}</Text>
            <TextInput style={styles.input} value={answer} onChangeText={setAnswer} placeholder="Your answer" placeholderTextColor={colors.muted} multiline />
            <Pressable
              style={[shared.btn, shared.btnPrimary, !answer.trim() && { opacity: 0.4 }]}
              disabled={!answer.trim()}
              onPress={() => {
                answerTask(task.id, answer.trim());
                setAnswer('');
              }}
            >
              <Text style={[shared.btnText, shared.btnTextPrimary]}>Send answer</Text>
            </Pressable>
          </View>
        ) : null}

        {task.result ? (
          <View style={styles.result}>
            <Text style={styles.resultText} selectable>{task.result}</Text>
          </View>
        ) : null}
        {task.error ? <Text style={styles.error} selectable>{task.error}</Text> : null}

        {open ? (
          <View style={{ marginTop: 8 }}>
            {task.steps.map((s, i) => (
              <View key={i} style={styles.step}>
                <Text style={styles.stepIcon}>{STEP_ICON[s.kind]}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{s.title}</Text>
                  {s.detail && s.kind !== 'result' ? <Text style={styles.stepDetail} numberOfLines={6} selectable>{s.detail}</Text> : null}
                </View>
              </View>
            ))}
            {!task.steps.length ? <Text style={styles.meta}>No steps yet.</Text> : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          {!finished ? (
            <Pressable style={[shared.btn, shared.btnDanger]} onPress={() => cancelTask(task.id)}>
              <Text style={shared.btnText}>Cancel</Text>
            </Pressable>
          ) : (
            <>
              <Pressable style={shared.btn} onPress={() => retryTask(task.id)}>
                <Text style={shared.btnText}>Run again</Text>
              </Pressable>
              <Pressable style={[shared.btn, shared.btnDanger]} onPress={() => removeTask(task.id)}>
                <Text style={shared.btnText}>Delete</Text>
              </Pressable>
            </>
          )}
          <Pressable style={shared.btn} onPress={() => setOpen((v) => !v)}>
            <Text style={shared.btnText}>{open ? 'Hide steps' : 'Show steps'}</Text>
          </Pressable>
        </View>
      </View>
      {children.map((c) => (
        <TaskCard key={c.id} task={c} depth={depth + 1} />
      ))}
    </View>
  );
}

function TasksTab() {
  const tasks = useAgents((s) => s.tasks);
  const top = useMemo(() => tasks.filter((t) => !t.parentId).slice().reverse(), [tasks]);
  const hasFinished = tasks.some((t) => t.status === 'done' || t.status === 'failed' || t.status === 'cancelled');
  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <NewTask />
      {top.length === 0 ? (
        <View>
          <Text style={styles.label}>Ideas</Text>
          {IDEAS.map((i) => (
            <Pressable key={i} style={styles.idea} onPress={() => enqueue({ agentId: 'atlas', goal: i })}>
              <Text style={styles.ideaText}>{i}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          {top.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
          {hasFinished ? (
            <Pressable style={[shared.btn, { alignSelf: 'center', marginTop: 6 }]} onPress={clearFinished}>
              <Text style={shared.btnText}>Clear finished</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function TeamTab() {
  const agents = useAgents((s) => s.agents);
  const notes = useAgents((s) => s.notes);
  const web = useApp((s) => s.settings.agentWeb);
  const parallel = useApp((s) => s.settings.agentParallel);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [role, setRole] = useState('');

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={shared.h2}>Internet access</Text>
            <Text style={styles.meta}>Lets agents search the web and read pages. Off keeps every task fully offline.</Text>
          </View>
          <Switch value={web} onValueChange={(v) => setSettings({ agentWeb: v })} />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={shared.h2}>Swarm size</Text>
            <Text style={styles.meta}>How many agents may work at the same time. Needs a model restart to take effect. More is faster overall but uses more memory.</Text>
          </View>
          <View style={styles.stepper}>
            <Pressable style={styles.stepBtn} onPress={() => setSettings({ agentParallel: Math.max(1, parallel - 1) })}>
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.stepValue}>{parallel}</Text>
            <Pressable style={styles.stepBtn} onPress={() => setSettings({ agentParallel: Math.min(4, parallel + 1) })}>
              <Text style={styles.stepText}>＋</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <Text style={styles.label}>Teammates</Text>
      {agents.map((a) => (
        <View key={a.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.who}>{a.emoji} {a.name}</Text>
            {!a.builtin ? (
              <Pressable onPress={() => removeAgent(a.id)} hitSlop={8}>
                <Text style={{ color: colors.danger, fontSize: 13 }}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.meta}>{a.role}</Text>
        </View>
      ))}

      <View style={styles.card}>
        <Text style={shared.h2}>Add a teammate</Text>
        <TextInput style={[styles.input, { marginTop: 8 }]} value={name} onChangeText={setName} placeholder="Name (e.g. Chef)" placeholderTextColor={colors.muted} />
        <TextInput style={[styles.input, { marginTop: 8 }]} value={emoji} onChangeText={setEmoji} placeholder="Emoji (optional)" placeholderTextColor={colors.muted} maxLength={4} />
        <TextInput style={[styles.input, { marginTop: 8 }]} value={role} onChangeText={setRole} placeholder="What is it good at? e.g. You plan meals and shopping lists." placeholderTextColor={colors.muted} multiline />
        <Pressable
          style={[shared.btn, shared.btnPrimary, { marginTop: 10 }, !name.trim() && { opacity: 0.4 }]}
          disabled={!name.trim()}
          onPress={() => {
            if (addAgent({ name, emoji, role })) {
              setName('');
              setEmoji('');
              setRole('');
            }
          }}
        >
          <Text style={[shared.btnText, shared.btnTextPrimary]}>Add</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Notebook ({notes.length})</Text>
      {notes.length === 0 ? <Text style={styles.meta}>Notes your agents save show up here.</Text> : null}
      {notes.slice().reverse().map((n) => (
        <View key={n.id} style={styles.card}>
          <Text style={styles.resultText} selectable>{n.text}</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>{ago(n.t)}</Text>
            <Pressable onPress={() => notesApi.remove(n.id)} hitSlop={8}>
              <Text style={{ color: colors.danger, fontSize: 13 }}>Delete</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

export function AgentsSheet() {
  const visible = useApp((s) => s.sheet === 'agents');
  const running = useAgents((s) => s.tasks.filter((t) => t.status === 'running' || t.status === 'queued').length);
  const waiting = useAgents((s) => s.tasks.filter((t) => t.status === 'waiting').length);
  const [tab, setTab] = useState<'tasks' | 'team'>('tasks');

  return (
    <Sheet visible={visible} title="Agents" onClose={() => openSheet('none')}>
      <View style={styles.tabs}>
        <Pressable style={[styles.tab, tab === 'tasks' && styles.tabOn]} onPress={() => setTab('tasks')}>
          <Text style={[styles.tabText, tab === 'tasks' && { color: colors.accent }]}>
            Tasks{running ? ` · ${running} active` : ''}{waiting ? ` · ${waiting} need you` : ''}
          </Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === 'team' && styles.tabOn]} onPress={() => setTab('team')}>
          <Text style={[styles.tabText, tab === 'team' && { color: colors.accent }]}>Team & notes</Text>
        </Pressable>
      </View>
      {visible ? tab === 'tasks' ? <TasksTab /> : <TeamTab /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 14, paddingBottom: 50 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabOn: { borderBottomWidth: 2, borderBottomColor: colors.accent },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 12, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { backgroundColor: colors.surfaceHi, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: colors.accentDim },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  input: { backgroundColor: colors.bg, color: colors.text, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minHeight: 44, textAlignVertical: 'top' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  who: { color: colors.text, fontSize: 15, fontWeight: '700' },
  pill: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '700' },
  goal: { color: colors.text, fontSize: 15, lineHeight: 21, marginTop: 6 },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  ask: { marginTop: 10, gap: 8 },
  askQ: { color: colors.warn, fontSize: 14, lineHeight: 20 },
  result: { marginTop: 10, backgroundColor: colors.bg, borderRadius: 12, padding: 10 },
  resultText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 12, marginTop: 8, lineHeight: 17 },
  step: { flexDirection: 'row', gap: 8, paddingVertical: 5 },
  stepIcon: { fontSize: 14, width: 22 },
  stepTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  stepDetail: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  idea: { backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, borderRadius: 12 },
  stepBtn: { paddingHorizontal: 14, paddingVertical: 8 },
  stepText: { color: colors.accent, fontSize: 18, fontWeight: '700' },
  stepValue: { color: colors.text, fontSize: 15, minWidth: 28, textAlign: 'center' },
  ideaText: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
