import React, { useEffect } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { ChatScreen } from './src/ui/ChatScreen';
import { ModelsSheet } from './src/ui/ModelsSheet';
import { DebugSheet } from './src/ui/DebugSheet';
import { SettingsSheet } from './src/ui/SettingsSheet';
import { useApp } from './src/ui/hooks';
import { boot } from './src/app/controller';
import { colors } from './src/ui/theme';
import { log, stringify } from './src/lib/log';

function Root() {
  const booted = useApp((s) => s.booted);
  const nativeMissing = useApp((s) => s.nativeMissing);

  useEffect(() => {
    boot().catch((e) => log.error('boot', 'boot failed', stringify(e)));
  }, []);

  if (!booted) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (nativeMissing) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Native module missing</Text>
        <Text style={styles.text}>This app needs its custom Android build (it cannot run in Expo Go). Install the APK produced by the GitHub workflow.</Text>
      </View>
    );
  }
  return (
    <>
      <ChatScreen />
      <ModelsSheet />
      <SettingsSheet />
      <DebugSheet />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <ErrorBoundary>
        <Root />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  text: { color: colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
