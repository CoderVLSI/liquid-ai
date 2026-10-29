import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp, useDownloads, useServer } from './hooks';
import { colors, shared } from './theme';
import { Icon } from './Icon';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { LivePanel } from './LivePanel';
import { dismissCrashes, newChat, openSheet, restartServer } from '../app/controller';
import { getModel } from '../models/catalog';
import type { ChatMsg } from '../state/app';

function Header() {
  const active = useApp((s) => s.settings.activeModel);
  const server = useServer();
  const dot = server.state === 'ready' ? colors.good : server.state === 'starting' ? colors.warn : server.state === 'error' ? colors.danger : colors.muted;
  return (
    <View style={styles.header}>
      <Pressable style={styles.modelChip} onPress={() => openSheet('models')} accessibilityLabel="Choose model">
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <Text style={styles.modelText} numberOfLines={1}>
          {active ? getModel(active).name : 'No model'}
        </Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>
      <View style={styles.headerBtns}>
        <Pressable style={styles.hBtn} onPress={newChat} accessibilityLabel="New chat">
          <Icon name="plus" size={24} />
        </Pressable>
        <Pressable style={styles.hBtn} onPress={() => openSheet('settings')} accessibilityLabel="Settings">
          <Icon name="settings" size={24} />
        </Pressable>
        <Pressable style={styles.hBtn} onPress={() => openSheet('debug')} accessibilityLabel="Debug">
          <Icon name="chip" size={24} />
        </Pressable>
      </View>
    </View>
  );
}

function Banners() {
  const server = useServer();
  const crashes = useApp((s) => s.crashes);
  return (
    <>
      {crashes.length > 0 ? (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Text style={styles.bannerText}>The app closed unexpectedly last time ({crashes.length} report{crashes.length > 1 ? 's' : ''}).</Text>
          <Pressable onPress={() => openSheet('debug')}>
            <Text style={styles.bannerLink}>View</Text>
          </Pressable>
          <Pressable onPress={dismissCrashes}>
            <Text style={styles.bannerLink}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}
      {server.state === 'starting' ? (
        <View style={styles.banner}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.bannerText}>Loading {server.modelId ? getModel(server.modelId).name : 'model'}… first load takes a few seconds</Text>
        </View>
      ) : null}
      {server.state === 'error' ? (
        <View style={[styles.banner, styles.bannerErr]}>
          <Text style={styles.bannerText} numberOfLines={3}>{server.error?.split('\n')[0] ?? 'Model engine error'}</Text>
          <Pressable onPress={() => openSheet('debug')}>
            <Text style={styles.bannerLink}>Details</Text>
          </Pressable>
          <Pressable onPress={() => void restartServer()}>
            <Text style={styles.bannerLink}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const heroArt = require('../../assets/art/hero.png');
const emptyArt = require('../../assets/art/empty.png');

function Empty() {
  const states = useDownloads();
  const anyReady = Object.values(states).some((s) => s.status === 'ready');
  return (
    <View style={styles.empty}>
      <Image source={anyReady ? emptyArt : heroArt} style={anyReady ? styles.emptyArt : styles.heroArt} resizeMode="contain" />
      <Text style={styles.emptyTitle}>{anyReady ? 'Ask anything' : 'LFM3 Pocket'}</Text>
      {anyReady ? (
        <Text style={styles.emptyText}>
          Type a message, attach a photo, or tap the mic for a live voice conversation. Everything stays on your phone.
        </Text>
      ) : (
        <>
          <Text style={styles.emptyText}>LFM3 Pocket runs Liquid AI's LFM3 models fully on your device. Download one to begin — the Omni model does voice, images and text.</Text>
          <Pressable style={[shared.btn, shared.btnPrimary, { marginTop: 16 }]} onPress={() => openSheet('models')}>
            <Text style={[shared.btnText, shared.btnTextPrimary]}>Choose models</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

export function ChatScreen() {
  const insets = useSafeAreaInsets();
  const messages = useApp((s) => s.messages);
  const voiceActive = useApp((s) => s.voice.active);
  const toast = useApp((s) => s.toast);
  const list = useRef<FlatList<ChatMsg>>(null);

  const last = messages[messages.length - 1];
  useEffect(() => {
    const t = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length, last?.text.length]);

  return (
    <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header />
      <Banners />
      <FlatList
        ref={list}
        style={{ flex: 1 }}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble msg={item} />}
        ListEmptyComponent={<Empty />}
        contentContainerStyle={messages.length ? { paddingVertical: 8 } : { flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      />
      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
      {voiceActive ? <LivePanel /> : <Composer />}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  modelChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '62%' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  modelText: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  caret: { color: colors.muted, fontSize: 12 },
  headerBtns: { flexDirection: 'row', gap: 4 },
  hBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  heroArt: { width: '100%', height: 190, marginBottom: 14 },
  emptyArt: { width: 200, height: 200, marginBottom: 4 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.surface },
  bannerWarn: { backgroundColor: '#3a2f14' },
  bannerErr: { backgroundColor: colors.dangerDim },
  bannerText: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 16 },
  bannerLink: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { color: colors.text, fontSize: 26, fontWeight: '700' },
  emptyText: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 },
  toast: { position: 'absolute', left: 24, right: 24, bottom: 130, backgroundColor: colors.surfaceHi, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
  toastText: { color: colors.text, fontSize: 14, textAlign: 'center' },
});
