import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, Image, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Press as Pressable } from './Press';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp, useDownloads, useServer } from './hooks';
import { colors, shared } from './theme';
import { Icon } from './Icon';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { LivePanel } from './LivePanel';
import { ModeToggle } from './ModeToggle';
import { FadeIn } from './FadeIn';
import { ms } from './motion';
import { AgentScreen } from './AgentScreen';
import { BuddyView } from './BuddyView';
import { dismissCrashes, newChat, openSheet, restartServer } from '../app/controller';
import { getModel } from '../models/catalog';
import type { ChatMsg } from '../state/app';

function Header() {
  const mode = useApp((s) => s.mode);
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
        {mode === 'chat' ? (
          <Pressable style={styles.hBtn} onPress={newChat} accessibilityLabel="New chat">
            <Icon name="plus" size={24} />
          </Pressable>
        ) : null}
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
  const buddyId = useApp((s) => s.settings.buddy);
  const name = useApp((s) => s.settings.agentName);
  const user = useApp((s) => s.settings.userName);
  return (
    <View style={styles.empty}>
      {anyReady && buddyId !== 'orb' ? (
        <BuddyView buddyId={buddyId} mood="idle" size={170} />
      ) : (
        <Image source={anyReady ? emptyArt : heroArt} style={anyReady ? styles.emptyArt : styles.heroArt} resizeMode="contain" />
      )}
      <Text style={styles.emptyTitle}>{anyReady ? (user ? `Hi ${user}!` : 'Ask anything') : 'LFM3 Pocket'}</Text>
      {anyReady && name ? <Text style={styles.emptyName}>{name} is listening</Text> : null}
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

/** Slides up and fades; keeps the last text while fading out so it does not blink to empty. */
function Toast({ text }: { text: string | null }) {
  const v = useRef(new Animated.Value(0)).current;
  const last = useRef('');
  if (text) last.current = text;
  useEffect(() => {
    Animated.timing(v, { toValue: text ? 1 : 0, duration: ms(text ? 180 : 240), easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [text, v]);
  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility={text ? 'auto' : 'no-hide-descendants'}
      style={[styles.toast, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}
    >
      <Text style={styles.toastText}>{last.current}</Text>
    </Animated.View>
  );
}

export function ChatScreen() {
  const insets = useSafeAreaInsets();
  const messages = useApp((s) => s.messages);
  const voiceActive = useApp((s) => s.voice.active);
  const toast = useApp((s) => s.toast);
  const mode = useApp((s) => s.mode);
  const list = useRef<FlatList<ChatMsg>>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // a new message (yours or the reply's first word) scrolls down with a short animation...
  useEffect(() => {
    atBottom.current = true;
    const t = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 30);
    return () => clearTimeout(t);
  }, [messages.length]);

  // ...while a streaming reply just keeps the end in view without animating every word (that was janky)
  const follow = () => {
    if (atBottom.current) list.current?.scrollToEnd({ animated: false });
  };
  const onScroll = (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const gap = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    atBottom.current = gap < 90;
    const far = gap > 260;
    setShowJump((v) => (v === far ? v : far));
  };

  return (
    <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header />
      <ModeToggle />
      <Banners />
      {mode === 'agent' ? (
        <AgentScreen />
      ) : (
        <>
          <FlatList
            ref={list}
            style={{ flex: 1 }}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item, index }) => <MessageBubble msg={item} animateIn={index >= messages.length - 2} isLast={index === messages.length - 1} />}
            onContentSizeChange={follow}
            onScroll={onScroll}
            scrollEventThrottle={64}
            windowSize={9}
            initialNumToRender={12}
            ListEmptyComponent={<Empty />}
            contentContainerStyle={messages.length ? { paddingVertical: 8 } : { flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          />
          {showJump && !voiceActive ? (
            <FadeIn y={8} duration={150} style={styles.jumpWrap}>
              <Pressable style={styles.jump} onPress={() => list.current?.scrollToEnd({ animated: true })} accessibilityLabel="Scroll to latest">
                <Text style={styles.jumpText}>↓</Text>
              </Pressable>
            </FadeIn>
          ) : null}
          {voiceActive ? <LivePanel /> : <Composer />}
        </>
      )}
      <Toast text={toast} />
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
  emptyName: { color: colors.accent, fontSize: 13, fontWeight: '700', marginTop: 2 },
  emptyText: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 },
  jumpWrap: { position: 'absolute', right: 16, bottom: 74 },
  jump: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceHi, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  jumpText: { color: colors.accent, fontSize: 20, fontWeight: '700' },
  toast: { position: 'absolute', left: 24, right: 24, bottom: 130, backgroundColor: colors.surfaceHi, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
  toastText: { color: colors.text, fontSize: 14, textAlign: 'center' },
});
