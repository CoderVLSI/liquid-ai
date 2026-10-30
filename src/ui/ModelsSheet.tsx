import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press as Pressable } from './Press';
import { Sheet } from './Sheet';
import { useApp, useDownloads, useServer } from './hooks';
import { colors, shared } from './theme';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { MODELS, formatBytes, totalBytes } from '../models/catalog';
import type { ModelDef } from '../models/catalog';
import { downloads } from '../models/downloads';
import type { ModelState } from '../models/downloads';
import { native } from '../native';
import { chooseModel, deleteModel, openSheet } from '../app/controller';

const CAP_LABEL = { text: 'Text', voice: 'Live voice', vision: 'Images' } as const;
const CAP_ICON: Record<keyof typeof CAP_LABEL, IconName> = { text: 'chat', voice: 'audio', vision: 'vision' };

// Card art from the LFM3 Pocket asset pack, one per model.
const BANNER = {
  omni: require('../../assets/art/card_omni.png'),
  audio: require('../../assets/art/card_audio.png'),
  vl: require('../../assets/art/card_vision.png'),
  text: require('../../assets/art/card_text.png'),
} as const;

function eta(s: ModelState): string {
  if (!s.speed || s.speed < 1) return '';
  const left = (s.bytesTotal - s.bytesDone) / s.speed;
  if (left > 3600) return ` · ${Math.round(left / 3600)} h left`;
  if (left > 60) return ` · ${Math.round(left / 60)} min left`;
  return ` · ${Math.round(left)} s left`;
}

function Card({ m, active }: { m: ModelDef; active: boolean }) {
  const st = useDownloads()[m.id];
  const server = useServer();
  const pct = st.bytesTotal ? Math.min(100, (st.bytesDone / st.bytesTotal) * 100) : 0;
  const loadingThis = server.state === 'starting' && server.modelId === m.id;
  const busy = st.status === 'downloading' || st.status === 'queued';

  return (
    <View style={[styles.card, active && styles.cardActive]}>
      <Image source={BANNER[m.id]} style={styles.banner} resizeMode="cover" />
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={shared.h2}>{m.name}</Text>
          <Text style={styles.tag}>{m.tagline}</Text>
        </View>
        {active ? (
          <View style={styles.activePill}>
            <Text style={styles.activeText}>{loadingThis ? 'Loading…' : server.state === 'ready' && server.modelId === m.id ? 'In use' : 'Selected'}</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.desc}>{m.description}</Text>
      <View style={styles.pills}>
        {m.capabilities.map((c) => (
          <View key={c} style={[shared.pill, styles.capPill]}>
            <Icon name={CAP_ICON[c]} size={12} />
            <Text style={shared.pillText}>{CAP_LABEL[c]}</Text>
          </View>
        ))}
        <View style={shared.pill}>
          <Text style={shared.pillText}>{formatBytes(totalBytes(m))}</Text>
        </View>
      </View>

      {busy || st.status === 'partial' ? (
        <View style={{ marginTop: 10 }}>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.progress}>
            {st.status === 'queued' ? 'Waiting… ' : st.status === 'partial' ? 'Paused · ' : ''}
            {formatBytes(st.bytesDone)} / {formatBytes(st.bytesTotal)}
            {st.status === 'downloading' && st.speed > 0 ? ` · ${(st.speed / 1e6).toFixed(1)} MB/s${eta(st)}` : ''}
          </Text>
        </View>
      ) : null}

      {st.status === 'error' ? <Text style={styles.error}>{st.error}</Text> : null}

      <View style={styles.actions}>
        {st.status === 'ready' ? (
          <>
            {!active ? (
              <Pressable style={[shared.btn, shared.btnPrimary]} onPress={() => void chooseModel(m.id)}>
                <Text style={[shared.btnText, shared.btnTextPrimary]}>Use this model</Text>
              </Pressable>
            ) : null}
            <Pressable style={[shared.btn, shared.btnDanger]} onPress={() => void deleteModel(m.id)}>
              <Text style={shared.btnText}>Delete</Text>
            </Pressable>
          </>
        ) : busy ? (
          <Pressable style={shared.btn} onPress={() => downloads.pause(m.id)}>
            <Text style={shared.btnText}>Pause</Text>
          </Pressable>
        ) : (
          <>
            <Pressable style={[shared.btn, shared.btnPrimary]} onPress={() => downloads.start(m.id)}>
              <Text style={[shared.btnText, shared.btnTextPrimary]}>
                {st.status === 'partial' ? 'Resume' : st.status === 'error' ? 'Retry' : 'Download'}
              </Text>
            </Pressable>
            {st.status === 'partial' || st.status === 'error' ? (
              <Pressable style={[shared.btn, shared.btnDanger]} onPress={() => void deleteModel(m.id)}>
                <Text style={shared.btnText}>Discard</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

export function ModelsSheet() {
  const visible = useApp((s) => s.sheet === 'models');
  const active = useApp((s) => s.settings.activeModel);
  const states = useDownloads();
  const [free, setFree] = useState<number | null>(null);

  useEffect(() => {
    if (visible) {
      try {
        setFree(native.info().freeDiskBytes);
      } catch {
        setFree(null);
      }
    }
  }, [visible, states]);

  const remaining = MODELS.filter((m) => states[m.id].status !== 'ready').reduce((a, m) => a + (totalBytes(m) - states[m.id].bytesDone), 0);
  const anyBusy = MODELS.some((m) => states[m.id].status === 'downloading' || states[m.id].status === 'queued');

  return (
    <Sheet visible={visible} title="Models" onClose={() => openSheet('none')}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Everything runs on this phone. Download only what you need — models are stored privately in the app and downloads resume if interrupted.
          {free != null ? `  Free storage: ${formatBytes(free)}.` : ''}
        </Text>

        {remaining > 0 ? (
          <Pressable
            style={[shared.btn, shared.btnPrimary, { marginBottom: 14 }]}
            onPress={() => (anyBusy ? MODELS.forEach((m) => downloads.pause(m.id)) : downloads.startAll())}
          >
            <Text style={[shared.btnText, shared.btnTextPrimary]}>
              {anyBusy ? 'Pause all downloads' : `Download all (${formatBytes(remaining)})`}
            </Text>
          </Pressable>
        ) : null}

        {MODELS.map((m) => (
          <Card key={m.id} m={m} active={active === m.id} />
        ))}
        <Text style={styles.foot}>Models © Liquid AI, LFM Open License v1.0. Downloaded from huggingface.co/LiquidAI.</Text>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  banner: { height: 118, borderRadius: 12, marginBottom: 12, width: '100%', backgroundColor: colors.surfaceHi },
  capPill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  card: { backgroundColor: colors.surface, borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  cardActive: { borderColor: colors.accent },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  tag: { color: colors.accent, fontSize: 13, marginTop: 2 },
  desc: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 8 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  activePill: { backgroundColor: colors.accentDim, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  activeText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceHi, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: colors.accent },
  progress: { color: colors.muted, fontSize: 12, marginTop: 6 },
  error: { color: colors.danger, fontSize: 12, marginTop: 8, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  foot: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 8 },
});
