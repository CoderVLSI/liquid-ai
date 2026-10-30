import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Press } from './Press';
import { FadeIn } from './FadeIn';
import { Icon } from './Icon';
import { Chip } from './AgentsSheet';
import { BuddyThumb, BuddyView } from './BuddyView';
import { useApp, useDownloads, useMcp } from './hooks';
import { colors, shared } from './theme';
import { closeSetup, finishSetup, openSheet, setSettings } from '../app/controller';
import { BUDDIES } from '../buddies/registry';
import type { BuddyData } from '../buddies/types';
import { getModel } from '../models/catalog';
import { downloads } from '../models/downloads';
import { INTERESTS, TONES } from '../state/profile';
import type { Settings } from '../state/settings';
import { ZONES, deviceZone, resolveZone, toWall, zoneValid } from '../lib/tz';
import { mcp } from '../mcp/manager';
import type { McpServerConfig } from '../mcp/types';

const STEPS = [
  { key: 'buddy', title: 'Meet your buddy', sub: 'Pick a companion and give it a name.' },
  { key: 'you', title: 'About you', sub: 'So it knows who it is helping and what you need.' },
  { key: 'time', title: 'Your time zone', sub: 'Reminders and words like “tomorrow 9am” use this clock.' },
  { key: 'brain', title: 'Get a brain', sub: 'The AI runs on your phone. Download it once.' },
  { key: 'tools', title: 'What may it use?', sub: 'You stay in control. Change this any time.' },
  { key: 'connect', title: 'Connect more', sub: 'Optional: MCP servers and your own computer or VM.' },
  { key: 'tour', title: 'Quick tour', sub: 'Where everything lives.' },
] as const;

interface Draft {
  buddy: string;
  agentName: string;
  userName: string;
  interests: string[];
  goals: string;
  tone: Settings['tone'];
  timezone: string;
  agentWeb: boolean;
  confirmWrites: boolean;
}

const hhmm = (zone: string) => {
  const d = toWall(new Date(), resolveZone(zone));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const newId = () => `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function Onboarding() {
  const insets = useSafeAreaInsets();
  const s = useApp((st) => st.settings);
  const rerun = s.onboarded; // opened again from Settings
  const [step, setStep] = useState(0);
  const [nameTouched, setNameTouched] = useState(rerun);
  const [d, setD] = useState<Draft>({
    buddy: s.buddy,
    agentName: s.agentName,
    userName: s.userName,
    interests: s.interests,
    goals: s.goals,
    tone: s.tone,
    timezone: s.timezone,
    agentWeb: s.agentWeb,
    confirmWrites: s.confirmWrites,
  });
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const last = step === STEPS.length - 1;
  const cur = STEPS[step];

  const finish = () => finishSetup(d);
  const leave = () => (rerun ? closeSetup() : finish());

  return (
    <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top + 6, paddingBottom: insets.bottom }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.top}>
        <View style={styles.dots}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotOn, i < step && styles.dotDone]} />
          ))}
        </View>
        <Press onPress={leave} hitSlop={10} haptic={false} accessibilityLabel={rerun ? 'Close setup' : 'Skip setup'}>
          <Text style={styles.skip}>{rerun ? 'Close' : 'Skip setup'}</Text>
        </Press>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <FadeIn key={cur.key} y={14} duration={220}>
          <Text style={styles.title}>{cur.title}</Text>
          <Text style={styles.sub}>{cur.sub}</Text>
          <View style={{ height: 14 }} />
          {cur.key === 'buddy' ? <BuddyStep d={d} set={set} nameTouched={nameTouched} setNameTouched={setNameTouched} /> : null}
          {cur.key === 'you' ? <YouStep d={d} set={set} /> : null}
          {cur.key === 'time' ? <TimeStep d={d} set={set} /> : null}
          {cur.key === 'brain' ? <BrainStep /> : null}
          {cur.key === 'tools' ? <ToolsStep d={d} set={set} /> : null}
          {cur.key === 'connect' ? <ConnectStep /> : null}
          {cur.key === 'tour' ? <TourStep name={d.agentName || 'Pocket'} /> : null}
        </FadeIn>
      </ScrollView>

      <View style={styles.footer}>
        {step > 0 ? (
          <Press style={[shared.btn, styles.back]} onPress={() => setStep(step - 1)} accessibilityLabel="Back">
            <Text style={shared.btnText}>Back</Text>
          </Press>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Press style={[shared.btn, shared.btnPrimary, styles.next]} onPress={() => (last ? finish() : setStep(step + 1))} accessibilityLabel={last ? 'Start' : 'Next'}>
          <Text style={[shared.btnText, shared.btnTextPrimary]}>{last ? (rerun ? 'Save' : 'Start') : 'Next'}</Text>
        </Press>
      </View>
    </KeyboardAvoidingView>
  );
}

// ---- steps -----------------------------------------------------------------------------------

type StepProps = { d: Draft; set: (p: Partial<Draft>) => void };

function BuddyStep({ d, set, nameTouched, setNameTouched }: StepProps & { nameTouched: boolean; setNameTouched: (v: boolean) => void }) {
  const pick = (b: BuddyData) => {
    set({ buddy: b.id, ...(nameTouched ? {} : { agentName: b.id === 'orb' ? 'Pocket' : b.name }) });
  };
  return (
    <>
      <View style={styles.preview}>
        <BuddyView buddyId={d.buddy} mood="idle" size={170} />
      </View>
      <Text style={styles.hint}>Tap your buddy to play with it.</Text>
      <Text style={styles.label}>Choose a buddy</Text>
      <View style={styles.grid}>
        {BUDDIES.map((b, i) => (
          <FadeIn key={b.id} delay={i * 60} style={styles.cell}>
            <Press style={[styles.card, d.buddy === b.id && { borderColor: b.color, backgroundColor: colors.surfaceHi }]} onPress={() => pick(b)} accessibilityLabel={`Buddy ${b.name}`}>
              <BuddyThumb buddyId={b.id} size={72} />
              <Text style={styles.cardName}>{b.name}</Text>
              {b.tagline ? (
                <Text style={styles.cardTag} numberOfLines={2}>
                  {b.tagline}
                </Text>
              ) : null}
            </Press>
          </FadeIn>
        ))}
      </View>
      <Text style={styles.hint}>More buddies: drop folders into assets/buddies (see docs/BUDDIES.md).</Text>
      <Text style={styles.label}>Its name</Text>
      <TextInput
        style={styles.input}
        value={d.agentName}
        onChangeText={(t) => {
          setNameTouched(true);
          set({ agentName: t });
        }}
        placeholder="Pocket"
        placeholderTextColor={colors.muted}
        maxLength={24}
        accessibilityLabel="Buddy name"
      />
    </>
  );
}

function YouStep({ d, set }: StepProps) {
  const toggle = (i: string) => set({ interests: d.interests.includes(i) ? d.interests.filter((x) => x !== i) : [...d.interests, i] });
  return (
    <>
      <Text style={styles.label}>Your name</Text>
      <TextInput style={styles.input} value={d.userName} onChangeText={(t) => set({ userName: t })} placeholder="What should it call you?" placeholderTextColor={colors.muted} maxLength={40} accessibilityLabel="Your name" />
      <Text style={styles.label}>What do you want help with?</Text>
      <View style={styles.chips}>
        {INTERESTS.map((i) => (
          <Chip key={i} label={i} on={d.interests.includes(i)} onPress={() => toggle(i)} />
        ))}
      </View>
      <Text style={styles.label}>Anything else? (optional)</Text>
      <TextInput
        style={[styles.input, { minHeight: 76, textAlignVertical: 'top' }]}
        value={d.goals}
        onChangeText={(t) => set({ goals: t })}
        placeholder="e.g. keep track of my college assignments and deadlines"
        placeholderTextColor={colors.muted}
        multiline
        maxLength={300}
        accessibilityLabel="What it should do"
      />
      <Text style={styles.label}>How should it talk?</Text>
      <View style={styles.chips}>
        {TONES.map((t) => (
          <Chip key={t.id} label={t.label} on={d.tone === t.id} onPress={() => set({ tone: t.id })} />
        ))}
      </View>
    </>
  );
}

function TimeStep({ d, set }: StepProps) {
  const [, tick] = useState(0);
  const [other, setOther] = useState('');
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);
  const known = ZONES.some((z) => z.id === d.timezone);
  const bad = other.trim().length > 0 && !zoneValid(other.trim());
  return (
    <>
      {ZONES.map((z) => {
        const on = d.timezone === z.id;
        return (
          <Press key={z.id} style={[styles.zone, on && styles.zoneOn]} onPress={() => set({ timezone: z.id })} pressScale={0.98} accessibilityLabel={`Time zone ${z.label}`}>
            <View style={[styles.radio, on && styles.radioOn]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.zoneName}>{z.id === 'auto' ? `Automatic (${deviceZone()})` : z.label}</Text>
              <Text style={styles.zoneSub}>{z.id === 'auto' ? 'Follows the phone, also when you travel' : `${z.short} · ${z.id}`}</Text>
            </View>
            <Text style={styles.zoneTime}>{hhmm(z.id)}</Text>
          </Press>
        );
      })}
      {!known ? (
        <Text style={styles.hint}>
          Using {d.timezone} · {hhmm(d.timezone)}
        </Text>
      ) : null}
      <Text style={styles.label}>Another zone</Text>
      <View style={styles.row}>
        <TextInput style={[styles.input, { flex: 1 }]} value={other} onChangeText={setOther} placeholder="e.g. Africa/Lagos" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Other time zone" />
        <Press style={[shared.btn, (!other.trim() || bad) && { opacity: 0.4 }]} disabled={!other.trim() || bad} onPress={() => set({ timezone: other.trim() })}>
          <Text style={shared.btnText}>Use</Text>
        </Press>
      </View>
      {bad ? <Text style={[styles.hint, { color: colors.danger }]}>That is not a zone name. Use the form Region/City.</Text> : null}
    </>
  );
}

function BrainStep() {
  const dl = useDownloads();
  const st = dl.omni;
  const m = getModel('omni');
  const gb = (st.bytesTotal / 1e9).toFixed(1);
  const pct = st.bytesTotal ? Math.min(100, Math.round((st.bytesDone / st.bytesTotal) * 100)) : 0;
  const anyReady = Object.values(dl).some((x) => x.status === 'ready');
  return (
    <>
      <View style={styles.panel}>
        <Text style={styles.cardName}>{m.name}</Text>
        <Text style={styles.zoneSub}>{m.tagline} · {gb} GB · recommended</Text>
        {st.status === 'ready' ? (
          <Text style={[styles.ok, { marginTop: 10 }]}>✓ Ready on this phone</Text>
        ) : st.status === 'downloading' || st.status === 'queued' ? (
          <>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${pct}%` }]} />
            </View>
            <Text style={styles.zoneSub}>Downloading… {pct}%. You can keep going; it continues in the background.</Text>
          </>
        ) : (
          <Press style={[shared.btn, shared.btnPrimary, { marginTop: 12 }]} onPress={() => downloads.start('omni')} accessibilityLabel="Download recommended model">
            <Text style={[shared.btnText, shared.btnTextPrimary]}>Download now (Wi-Fi recommended)</Text>
          </Press>
        )}
        {st.status === 'error' ? <Text style={[styles.hint, { color: colors.danger }]}>{st.error ?? 'Download failed. Try again from Models.'}</Text> : null}
      </View>
      <Text style={styles.hint}>
        {anyReady ? 'You already have a model. ' : ''}It handles chat, photos and live voice. Smaller or specialised models are in Models.
      </Text>
      <Press style={[shared.btn, { alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => openSheet('models')}>
        <Text style={shared.btnText}>See all models</Text>
      </Press>
    </>
  );
}

function ToolsStep({ d, set }: StepProps) {
  return (
    <>
      <View style={styles.switchRow}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.cardName}>Use the internet</Text>
          <Text style={styles.zoneSub}>Web search and reading pages. Off keeps everything fully offline.</Text>
        </View>
        <Switch value={d.agentWeb} onValueChange={(v) => set({ agentWeb: v })} />
      </View>
      <View style={styles.switchRow}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.cardName}>Ask me before it acts</Text>
          <Text style={styles.zoneSub}>Posting, sending email, creating events: it waits for your OK. Strongly recommended.</Text>
        </View>
        <Switch value={d.confirmWrites} onValueChange={(v) => set({ confirmWrites: v })} />
      </View>
      <View style={styles.panel}>
        <Text style={styles.cardName}>Slack, Gmail, Calendar, Drive</Text>
        <Text style={styles.zoneSub}>Sign in with your own accounts. Tokens stay on this phone.</Text>
        <Press style={[shared.btn, { marginTop: 10, alignSelf: 'flex-start' }]} onPress={() => openSheet('agents')} accessibilityLabel="Open connections">
          <Text style={shared.btnText}>Set up connections</Text>
        </Press>
      </View>
      <Text style={styles.hint}>Built in, no setup: reminders, notes, to-dos, calculator, unit converter, weather, Wikipedia.</Text>
    </>
  );
}

function ConnectStep() {
  const servers = useApp((st) => st.settings.mcpServers);
  const status = useMcp();
  return (
    <>
      {servers.length ? <Text style={styles.label}>Connected</Text> : null}
      {servers.map((c) => {
        const st = status[c.id];
        return (
          <View key={c.id} style={styles.server}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName}>{c.kind === 'pc' ? '💻 ' : '🔌 '}{c.name}</Text>
              <Text style={styles.zoneSub} numberOfLines={1}>{c.url}</Text>
              <Text style={[styles.zoneSub, st?.state === 'ready' ? { color: colors.good } : st?.state === 'error' ? { color: colors.danger } : null]} numberOfLines={3}>
                {st?.state === 'ready' ? `Connected · ${st.tools.length} tools` : st?.state === 'error' ? st.error : st?.state === 'connecting' ? 'Connecting…' : c.enabled ? '…' : 'Off'}
              </Text>
            </View>
            <Press style={[shared.btn, shared.btnDanger]} onPress={() => setSettings({ mcpServers: servers.filter((x) => x.id !== c.id) })} accessibilityLabel={`Remove ${c.name}`}>
              <Text style={shared.btnText}>Remove</Text>
            </Press>
          </View>
        );
      })}
      <AddServer kind="mcp" servers={servers} />
      <AddServer kind="pc" servers={servers} />
    </>
  );
}

function AddServer({ kind, servers }: { kind: 'mcp' | 'pc'; servers: McpServerConfig[] }) {
  const pc = kind === 'pc';
  const [name, setName] = useState(pc ? 'My PC' : '');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [approve, setApprove] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const add = async () => {
    const cfg: McpServerConfig = { id: newId(), name: name.trim() || (pc ? 'My PC' : 'Server'), url: url.trim(), token: token.trim(), enabled: true, approve: pc ? true : approve, kind };
    setBusy(true);
    setMsg(null);
    const r = await mcp.test(cfg);
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.error ?? 'Could not connect.' });
      return;
    }
    setSettings({ mcpServers: [...servers, cfg] });
    setMsg({ ok: true, text: `Connected: ${r.tools.length} tools (${r.tools.slice(0, 4).join(', ')}${r.tools.length > 4 ? '…' : ''})` });
    setUrl('');
    setToken('');
    if (!pc) setName('');
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.cardName}>{pc ? 'Remote computer or VM' : 'MCP server'}</Text>
      <Text style={styles.zoneSub}>
        {pc
          ? 'Let it look at files and run commands on your PC or a VM, with your approval each time. On that computer run tools/pc-bridge/pc_bridge.py (see its README), then paste the URL and token it prints.'
          : 'Any remote MCP server (streamable HTTP). Its tools become available to your buddy.'}
      </Text>
      {!pc ? <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name, e.g. Notion" placeholderTextColor={colors.muted} accessibilityLabel="MCP server name" /> : null}
      <TextInput
        style={[styles.input, { marginTop: 8 }]}
        value={url}
        onChangeText={setUrl}
        placeholder={pc ? 'http://192.168.1.20:8765/mcp' : 'https://example.com/mcp'}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel={pc ? 'Computer URL' : 'MCP server URL'}
      />
      <TextInput
        style={[styles.input, { marginTop: 8 }]}
        value={token}
        onChangeText={setToken}
        placeholder={pc ? 'Access token' : 'Access token (if it needs one)'}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        accessibilityLabel={pc ? 'Computer token' : 'MCP token'}
      />
      {!pc ? (
        <View style={[styles.switchRow, { backgroundColor: 'transparent', paddingHorizontal: 0 }]}>
          <Text style={[styles.zoneSub, { flex: 1 }]}>Ask me before its tools run</Text>
          <Switch value={approve} onValueChange={setApprove} />
        </View>
      ) : null}
      <Press style={[shared.btn, shared.btnPrimary, { marginTop: 10 }, (!url.trim() || busy) && { opacity: 0.4 }]} disabled={!url.trim() || busy} onPress={() => void add()} accessibilityLabel={pc ? 'Test and connect computer' : 'Test and add MCP server'}>
        <Text style={[shared.btnText, shared.btnTextPrimary]}>{busy ? 'Testing…' : 'Test & add'}</Text>
      </Press>
      {msg ? <Text style={[styles.hint, { color: msg.ok ? colors.good : colors.danger }]}>{msg.text}</Text> : null}
    </View>
  );
}

function TourStep({ name }: { name: string }) {
  const items: { icon: 'plus' | 'audio' | 'gallery' | 'settings' | 'bolt'; title: string; text: string }[] = [
    { icon: 'bolt', title: 'Chat | Agent', text: `The switch at the top. Chat is for talking. In Agent mode ${name} works on tasks in the background: reminders, notes, research, your connected tools.` },
    { icon: 'audio', title: 'Talk live', text: 'With the message box empty, the round button is a microphone: tap it for a live voice conversation.' },
    { icon: 'gallery', title: 'Show it a photo', text: 'The picture button next to the box attaches an image to ask about (needs the Omni or VL model).' },
    { icon: 'plus', title: 'Your buddy', text: `Tap ${name} to play. It sleeps when no model is loaded and hops when it needs a decision.` },
    { icon: 'settings', title: 'Change anything later', text: 'Gear icon → Profile & setup reopens this guide: name, time zone, buddy, tools.' },
  ];
  return (
    <>
      {items.map((it, i) => (
        <FadeIn key={it.title} delay={i * 80}>
          <View style={styles.tour}>
            <View style={styles.tourIcon}>
              <Icon name={it.icon} size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName}>{it.title}</Text>
              <Text style={styles.zoneSub}>{it.text}</Text>
            </View>
          </View>
        </FadeIn>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 6 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { width: 22, backgroundColor: colors.accent },
  dotDone: { backgroundColor: colors.accentDim },
  skip: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  body: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 16, marginBottom: 8 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  input: { backgroundColor: colors.surface, color: colors.text, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preview: { alignItems: 'center', justifyContent: 'center', minHeight: 190 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  cell: { width: '50%', padding: 4 },
  card: { alignItems: 'center', padding: 12, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, minHeight: 150 },
  cardName: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 4 },
  cardTag: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 2, lineHeight: 15 },
  zone: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, marginBottom: 8 },
  zoneOn: { borderColor: colors.accent, backgroundColor: colors.surfaceHi },
  zoneName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  zoneSub: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  zoneTime: { color: colors.accent, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.muted },
  radioOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  panel: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.border },
  switchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.border, marginTop: 12, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: colors.accent },
  ok: { color: colors.good, fontSize: 14, fontWeight: '700' },
  server: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  tour: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  tourIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentDim, alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  back: { flex: 1, paddingVertical: 14 },
  next: { flex: 2, paddingVertical: 14 },
});
