import React from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { log, stringify } from '../lib/log';
import { native } from '../native';
import { colors, mono } from './theme';

interface State {
  error: Error | null;
  info: string;
}

/** Last line of defence: a render error shows the details instead of a white screen. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const text = `${stringify(error)}\n\ncomponent stack:${info.componentStack}\n\n--- last log lines ---\n${log.dump(100)}`;
    log.error('render', stringify(error), info.componentStack);
    try {
      native.writeCrash('js-render', text);
    } catch {
      // ignore
    }
    this.setState({ info: info.componentStack ?? '' });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    const report = `${stringify(error)}\n${info}`;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Something broke</Text>
        <Text style={styles.sub}>The details were saved. Share them to get it fixed.</Text>
        <ScrollView style={styles.box}>
          <Text style={styles.text} selectable>{report}</Text>
        </ScrollView>
        <View style={styles.row}>
          <Pressable style={styles.btn} onPress={() => void Share.share({ message: report + '\n\n' + log.dump(150) })}>
            <Text style={styles.btnText}>Share report</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.primary]} onPress={() => this.setState({ error: null, info: '' })}>
            <Text style={[styles.btnText, { color: colors.onAccent }]}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 60 },
  title: { color: colors.danger, fontSize: 24, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 14, marginTop: 6, marginBottom: 14 },
  box: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12 },
  text: { color: colors.text, fontSize: 11, lineHeight: 16, ...mono },
  row: { flexDirection: 'row', gap: 12, marginTop: 14, marginBottom: 20 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.surfaceHi, alignItems: 'center' },
  primary: { backgroundColor: colors.accent },
  btnText: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
