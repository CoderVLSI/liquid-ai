import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Press as Pressable } from './Press';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from './theme';

export function Sheet({
  visible,
  title,
  onClose,
  right,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.right}>
            {right}
            <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Close" hitSlop={8}>
              <Text style={styles.closeText}>Done</Text>
            </Pressable>
          </View>
        </View>
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  close: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.surfaceHi },
  closeText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
