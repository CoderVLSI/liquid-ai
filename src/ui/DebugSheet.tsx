import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Sheet } from './Sheet';
import { useApp, useLogs, useServer } from './hooks';
import { colors, mono, shared } from './theme';
import { formatEntry, log } from '../lib/log';
import { native, nativeAvailable } from '../native';
import type { ExitReason } from '../native';
import { dismissCrashes, openSheet, restartServer } from '../app/controller';
import { server } from '../server/ServerManager';

type Tab = 'logs' | 'server' | 'crashes' | 'device' | 'logcat';
const TABS: { id: Tab; label: string }[] = [
  { id: 'logs', label: 'Logs' },
  { id: 'server', label: 'Server' },
  { id: 'crashes', label: 'Crashes' },
  { id: 'device', label: 'Device' },
  { id: 'logcat', label: 'Logcat' },
];

const share = (title: string, message: string) => void Share.share({ title, message: message.slice(-90_000) }).catch(() => {});

function LogsTab() {
  const entries = useLogs();
  const [onlyWarn, setOnlyWarn] = useState(false);
  // newest first: the list is inverted so the latest line sits at the bottom
  const shown = useMemo(
    () => (onlyWarn ? entries.filter((e) => e.level === 'warn' || e.level === 'error') : entries).slice(-600).reverse(),
    [entries, onlyWarn],
  );
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.toolbar}>
        <Pressable style={[styles.chip, onlyWarn && styles.chipOn]} onPress={() => setOnlyWarn((v) => !v)}>
          <Text style={styles.chipText}>Warnings + errors</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => share('Liquid Voice logs', log.dump(2000))}>
          <Text style={styles.chipText}>Share all</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => log.clear()}>
          <Text style={styles.chipText}>Clear</Text>
        </Pressable>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(e) => String(e.id)}
        inverted
        renderItem={({ item }) => (
          <Text style={[styles.line, item.level === 'error' && { color: colors.danger }, item.level === 'warn' && { color: colors.warn }, item.level === 'debug' && { color: colors.muted }]} selectable>
            {formatEntry(item)}
          </Text>
        )}
        contentContainerStyle={{ padding: 10 }}
      />
    </View>
  );
}

function ServerTab() {
  const st = useServer();
  const [tail, setTail] = useState('');
  useEffect(() => {
    const t = setInterval(() => setTail(native.serverTail()), 1000);
    setTail(native.serverTail());
    return () => clearInterval(t);
  }, []);
  const color = st.state === 'ready' ? colors.good : st.state === 'error' ? colors.danger : st.state === 'starting' ? colors.warn : colors.muted;
  return (
    <ScrollView contentContainerStyle={{ padding: 14 }}>
      <Text style={[shared.h2, { color }]}>
        {st.state.toUpperCase()} {st.modelId ? `· ${st.modelId}` : ''} {st.loadMs ? `· loaded in ${(st.loadMs / 1000).toFixed(1)} s` : ''}
      </Text>
      {st.modalities ? <Text style={shared.muted}>server reports: vision={String(st.modalities.vision)} audio={String(st.modalities.audio)}</Text> : null}
      {st.error ? <Text style={styles.err} selectable>{st.error}</Text> : null}
      <View style={styles.toolbar}>
        <Pressable style={styles.chip} onPress={() => void restartServer()}>
          <Text style={styles.chipText}>Restart server</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => void server.stop()}>
          <Text style={styles.chipText}>Stop</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => share('Model server output', tail)}>
          <Text style={styles.chipText}>Share output</Text>
        </Pressable>
      </View>
      <Text style={[shared.h2, { marginTop: 12 }]}>Server output (last 300 lines)</Text>
      <Text style={styles.block} selectable>{tail || '(nothing yet)'}</Text>
    </ScrollView>
  );
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString();
}

function CrashesTab() {
  const crashes = useApp((s) => s.crashes);
  const exits = useApp((s) => s.exitReasons);
  return (
    <ScrollView contentContainerStyle={{ padding: 14 }}>
      <Text style={shared.h2}>Crash reports</Text>
      <Text style={shared.muted}>Written to disk the moment a crash happens, so they survive the app closing.</Text>
      {crashes.length === 0 ? <Text style={[shared.muted, { marginTop: 8 }]}>None 🎉</Text> : null}
      {crashes.map((c) => (
        <View key={c.name} style={styles.card}>
          <Text style={styles.cardTitle}>{c.name}</Text>
          <Text style={styles.block} selectable numberOfLines={40}>{c.text}</Text>
          <Pressable style={styles.chip} onPress={() => share(c.name, c.text)}>
            <Text style={styles.chipText}>Share</Text>
          </Pressable>
        </View>
      ))}
      {crashes.length ? (
        <Pressable style={[styles.chip, { alignSelf: 'flex-start', marginTop: 8 }]} onPress={dismissCrashes}>
          <Text style={styles.chipText}>Clear reports</Text>
        </Pressable>
      ) : null}

      <Text style={[shared.h2, { marginTop: 22 }]}>Why Android ended earlier runs</Text>
      <Text style={shared.muted}>Catches silent kills (out of memory, native crashes) that leave no report of their own.</Text>
      {exits.length === 0 ? <Text style={[shared.muted, { marginTop: 8 }]}>No history (needs Android 11+).</Text> : null}
      {exits.map((e: ExitReason, i) => (
        <View key={i} style={styles.card}>
          <Text style={[styles.cardTitle, /LOW_MEMORY|CRASH|ANR|SIGNALED/.test(e.reason) && { color: colors.danger }]}>{e.reason}</Text>
          <Text style={shared.muted}>{fmtTime(e.timestamp)} · {e.process}</Text>
          {e.description ? <Text style={styles.block} selectable>{e.description}</Text> : null}
          <Text style={shared.muted}>status {e.status} · RSS {Math.round(e.rssKb / 1024)} MB · PSS {Math.round(e.pssKb / 1024)} MB</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function DeviceTab() {
  const [text, setText] = useState('');
  const refresh = useCallback(() => {
    if (!nativeAvailable) return setText('Native module missing');
    try {
      const i = native.info();
      const m = native.memory();
      setText(
        [
          `device: ${i.device}`,
          `android sdk: ${i.sdk}`,
          `cpu abis: ${i.abis.join(', ')}  (${i.cores} cores)`,
          `RAM: ${(i.totalRamBytes / 1e9).toFixed(1)} GB total, ${(m.availRamBytes / 1e9).toFixed(1)} GB free${m.lowMemory ? '  ⚠ LOW MEMORY' : ''}`,
          `free storage: ${(i.freeDiskBytes / 1e9).toFixed(1)} GB`,
          `files dir: ${i.filesDir}`,
          `native lib dir: ${i.nativeLibraryDir}`,
          `server binary: ${i.serverBinaryPresent ? `present (${Math.round(i.serverBinarySize / 1e6)} MB)` : 'MISSING'}`,
        ].join('\n'),
      );
    } catch (e: any) {
      setText(String(e?.message ?? e));
    }
  }, []);
  useEffect(refresh, [refresh]);
  return (
    <ScrollView contentContainerStyle={{ padding: 14 }}>
      <Text style={styles.block} selectable>{text}</Text>
      <View style={styles.toolbar}>
        <Pressable style={styles.chip} onPress={refresh}>
          <Text style={styles.chipText}>Refresh</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => share('Device info', text)}>
          <Text style={styles.chipText}>Share</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function LogcatTab() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setText(await native.logcat(1500));
    } catch (e: any) {
      setText(`could not read logcat: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <ScrollView contentContainerStyle={{ padding: 14 }}>
      <Text style={shared.muted}>This app's own system log (tags: LiquidVoice, ReactNativeJS, AndroidRuntime…). Great for native crashes.</Text>
      <View style={styles.toolbar}>
        <Pressable style={styles.chip} onPress={() => void load()}>
          <Text style={styles.chipText}>{busy ? 'Loading…' : 'Reload'}</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => share('logcat', text)}>
          <Text style={styles.chipText}>Share</Text>
        </Pressable>
      </View>
      <Text style={[styles.block, { fontSize: 10 }]} selectable>{text}</Text>
    </ScrollView>
  );
}

export function DebugSheet() {
  const visible = useApp((s) => s.sheet === 'debug');
  const [tab, setTab] = useState<Tab>('logs');
  return (
    <Sheet visible={visible} title="Debug" onClose={() => openSheet('none')}>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={[styles.tab, tab === t.id && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t.id && { color: colors.accent }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {visible ? (
        tab === 'logs' ? <LogsTab /> : tab === 'server' ? <ServerTab /> : tab === 'crashes' ? <CrashesTab /> : tab === 'device' ? <DeviceTab /> : <LogcatTab />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabOn: { borderBottomWidth: 2, borderBottomColor: colors.accent },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 10, paddingHorizontal: 2 },
  chip: { backgroundColor: colors.surfaceHi, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: colors.accentDim },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  line: { color: colors.text, fontSize: 11, lineHeight: 15, ...mono },
  block: { color: colors.text, fontSize: 11, lineHeight: 16, backgroundColor: colors.surface, borderRadius: 10, padding: 10, marginTop: 8, ...mono },
  err: { color: colors.danger, fontSize: 12, lineHeight: 17, marginTop: 8 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginTop: 10, borderWidth: 1, borderColor: colors.border },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 4 },
});
