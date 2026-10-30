import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Sheet } from './Sheet';
import { useAgents, useApp, useConnections } from './hooks';
import { colors, shared } from './theme';
import { answerTask, approveTask, cancelTask, notesApi, removeTask, retryTask } from '../agents/runner';
import { openSheet, setSettings } from '../app/controller';
import type { AgentTask, Step, TaskStatus } from '../agents/types';
import { connectSlack, connStore, disconnectGoogle, disconnectSlack, startGoogleSignIn } from '../connections/store';
import { REDIRECT_URI, SCOPE_LABELS } from '../connections/google';
import type { GoogleScope } from '../connections/google';

export const STATUS: Record<TaskStatus, { label: string; color: string }> = {
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

export const IDEAS = [
  'Remind me at 5pm to submit the assignment',
  'Add buy milk to my to-do list',
  'What is the weather in Pilani?',
  'Who is Ada Lovelace?',
];

export function ago(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function inFuture(t?: number): string {
  if (!t) return '';
  const m = Math.max(0, Math.round((t - Date.now()) / 60000));
  return m < 60 ? `in ${m} min` : m < 1440 ? `in ${Math.round(m / 60)} h` : `in ${Math.round(m / 1440)} d`;
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

export function TaskCard({ task, depth = 0, compact = false }: { task: AgentTask; depth?: number; compact?: boolean }) {
  const agents = useAgents((s) => s.agents);
  const tasks = useAgents((s) => s.tasks);
  const [open, setOpen] = useState(task.status === 'waiting');
  const [answer, setAnswer] = useState('');
  const agent = agents.find((a) => a.id === task.agentId);
  const st = STATUS[task.status];
  const children = tasks.filter((t) => t.parentId === task.id);
  const approval = task.pending.find((p) => p.kind === 'approve');
  const question = task.pending.find((p) => p.kind === 'ask')?.question;
  const finished = task.status === 'done' || task.status === 'failed' || task.status === 'cancelled';

  return (
    <View style={{ marginLeft: depth * 14 }}>
      <View style={[styles.card, task.status === 'waiting' && { borderColor: colors.warn }]}>
        <Pressable onPress={() => setOpen((v) => !v)}>
          <View style={styles.head}>
            <Text style={styles.who}>{agent?.hidden ? `🛠 Helper · ${agent.name}` : `${agent?.emoji ?? '🤖'} ${agent?.name ?? 'Agent'}`}</Text>
            <View style={[styles.pill, { backgroundColor: st.color + '26' }]}>
              <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
            </View>
          </View>
          {compact ? null : <Text style={styles.goal} numberOfLines={open ? undefined : 2}>{task.goal}</Text>}
          <Text style={styles.meta}>
            {task.status === 'scheduled' ? `Starts ${inFuture(task.runAt)}` : ago(task.updatedAt)}
            {task.everyMinutes ? ` · repeats every ${task.everyMinutes >= 1440 ? 'day' : 'hour'}` : ''}
            {task.stepCount ? ` · ${task.stepCount} model call${task.stepCount > 1 ? 's' : ''}` : ''}
          </Text>
        </Pressable>

        {task.status === 'waiting' && approval ? (
          <View style={styles.ask}>
            <Text style={styles.askQ}>🔐 {task.pending.length > 1 ? 'Approval needed' : 'Approve this action?'}</Text>
            <View style={styles.result}>
              <Text style={styles.resultText} selectable>{approval.question}</Text>
            </View>
            <View style={styles.actions}>
              <Pressable style={[shared.btn, shared.btnPrimary]} onPress={() => void approveTask(task.id, true)}>
                <Text style={[shared.btnText, shared.btnTextPrimary]}>Approve</Text>
              </Pressable>
              <Pressable style={[shared.btn, shared.btnDanger]} onPress={() => void approveTask(task.id, false)}>
                <Text style={shared.btnText}>Deny</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

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

const ALL_SCOPES: GoogleScope[] = ['calendar', 'gmailRead', 'gmailSend', 'drive'];

function ConnectionsTab() {
  const slack = useConnections((s) => s.slack);
  const google = useConnections((s) => s.google);
  const pending = useConnections((s) => s.pendingGoogle);
  const busy = useConnections((s) => s.busy);
  const error = useConnections((s) => s.error);
  const [token, setToken] = useState('');
  const [clientId, setClientId] = useState(google?.clientId ?? '');
  const [scopes, setScopes] = useState<GoogleScope[]>(google?.scopes ?? ['calendar', 'gmailRead', 'drive']);
  const toggle = (s: GoogleScope) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Text style={styles.meta}>
        Connect your accounts so agents can read and (with your approval) act on them. Credentials stay on this phone, in the app's private storage,
        and are only ever sent to Slack / Google.
      </Text>
      {error ? (
        <View style={[styles.card, { borderColor: colors.danger, marginTop: 10 }]}>
          <Text style={styles.error} selectable>{error}</Text>
          <Pressable onPress={() => connStore.set({ error: null })} hitSlop={8}>
            <Text style={{ color: colors.accent, fontSize: 13, marginTop: 6 }}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.label}>Slack</Text>
      <View style={styles.card}>
        {slack ? (
          <>
            <Text style={styles.who}>✅ {slack.team} · {slack.user}</Text>
            <Text style={styles.meta}>Agents can list channels, read recent messages and (after approval) post.</Text>
            <View style={styles.actions}>
              <Pressable style={[shared.btn, shared.btnDanger]} onPress={disconnectSlack}>
                <Text style={shared.btnText}>Disconnect</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.meta}>
              1. Go to api.slack.com/apps → Create New App → From scratch.{'\n'}
              2. OAuth & Permissions → Bot Token Scopes: channels:read, groups:read, channels:history, groups:history, chat:write, users:read.{'\n'}
              3. Install to Workspace, copy the "Bot User OAuth Token" (xoxb-…) and paste it here.{'\n'}
              4. In Slack, invite the bot to channels: /invite @yourbot
            </Text>
            <TextInput style={[styles.input, { marginTop: 8 }]} value={token} onChangeText={setToken} placeholder="xoxb-…" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <Pressable style={[shared.btn, shared.btnPrimary, { marginTop: 10 }, (!token.trim() || busy === 'slack') && { opacity: 0.4 }]} disabled={!token.trim() || busy === 'slack'} onPress={() => void connectSlack(token)}>
              <Text style={[shared.btnText, shared.btnTextPrimary]}>{busy === 'slack' ? 'Checking…' : 'Connect Slack'}</Text>
            </Pressable>
          </>
        )}
      </View>

      <Text style={styles.label}>Google (Calendar, Gmail, Drive)</Text>
      <View style={styles.card}>
        {google ? (
          <>
            <Text style={styles.who}>✅ {google.email ?? 'Google account'}</Text>
            <Text style={styles.meta}>Allowed: {google.scopes.map((s) => SCOPE_LABELS[s]).join(', ')}</Text>
            <View style={styles.actions}>
              <Pressable style={shared.btn} onPress={() => startGoogleSignIn(google.clientId, google.scopes)}>
                <Text style={shared.btnText}>Re-authorize</Text>
              </Pressable>
              <Pressable style={[shared.btn, shared.btnDanger]} onPress={disconnectGoogle}>
                <Text style={shared.btnText}>Disconnect</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.meta}>
              Google needs an OAuth client from your own Google Cloud project (free):{'\n'}
              1. console.cloud.google.com → create a project → enable the Calendar, Gmail and Drive APIs.{'\n'}
              2. APIs & Services → OAuth consent screen: External, add yourself as a test user.{'\n'}
              3. Credentials → Create OAuth client ID → type Android. Package name: com.codervlsi.lfm3pocket. SHA-1: the signing key of the APK you installed (see README). Under Advanced, enable "custom URI scheme".{'\n'}
              4. Paste the Client ID below and sign in. Redirect used: {REDIRECT_URI}
            </Text>
            <TextInput style={[styles.input, { marginTop: 8 }]} value={clientId} onChangeText={setClientId} placeholder="123-abc.apps.googleusercontent.com" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
            <View style={[styles.row, { marginTop: 10 }]}>
              {ALL_SCOPES.map((s) => (
                <Chip key={s} label={SCOPE_LABELS[s]} on={scopes.includes(s)} onPress={() => toggle(s)} />
              ))}
            </View>
            <Pressable style={[shared.btn, shared.btnPrimary, { marginTop: 12 }, busy === 'google' && { opacity: 0.4 }]} disabled={busy === 'google'} onPress={() => startGoogleSignIn(clientId, scopes)}>
              <Text style={[shared.btnText, shared.btnTextPrimary]}>{pending ? 'Waiting for Google… (tap to retry)' : 'Sign in with Google'}</Text>
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function OptionsTab() {
  const notes = useAgents((s) => s.notes);
  const web = useApp((s) => s.settings.agentWeb);
  const parallel = useApp((s) => s.settings.agentParallel);
  const confirm = useApp((s) => s.settings.confirmWrites);

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={shared.h2}>Internet access</Text>
            <Text style={styles.meta}>Lets Pocket search the web and read pages. Off keeps every task fully offline.</Text>
          </View>
          <Switch value={web} onValueChange={(v) => setSettings({ agentWeb: v })} />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={shared.h2}>Ask before acting</Text>
            <Text style={styles.meta}>Pocket must get your approval before posting to Slack, sending email or creating calendar events. Strongly recommended.</Text>
          </View>
          <Switch value={confirm} onValueChange={(v) => setSettings({ confirmWrites: v })} />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={shared.h2}>Helpers working at once</Text>
            <Text style={styles.meta}>Pocket can split a big job between hidden helpers that work in parallel. More is faster overall but uses more memory. Applies after a model restart.</Text>
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

      <Text style={styles.label}>Notebook ({notes.length})</Text>
      {notes.length === 0 ? <Text style={styles.meta}>Notes Pocket saves for you show up here.</Text> : null}
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
  const [tab, setTab] = useState<'options' | 'connect'>('options');

  return (
    <Sheet visible={visible} title="Agent settings" onClose={() => openSheet('none')}>
      <View style={styles.tabs}>
        <Pressable style={[styles.tab, tab === 'options' && styles.tabOn]} onPress={() => setTab('options')}>
          <Text style={[styles.tabText, tab === 'options' && { color: colors.accent }]}>Options & notes</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === 'connect' && styles.tabOn]} onPress={() => setTab('connect')}>
          <Text style={[styles.tabText, tab === 'connect' && { color: colors.accent }]}>Connections</Text>
        </Pressable>
      </View>
      {visible ? tab === 'options' ? <OptionsTab /> : <ConnectionsTab /> : null}
    </Sheet>
  );
}

export const styles = StyleSheet.create({
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
