import React, { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from './hooks';
import { colors } from './theme';
import { Icon } from './Icon';
import { clearAttachment, pickImage, sendMessage, stopGenerating, toggleVoice } from '../app/controller';

export function Composer() {
  const [text, setText] = useState('');
  const attachment = useApp((s) => s.attachment);
  const generating = useApp((s) => s.generating);

  const canSend = text.trim().length > 0 || attachment != null;

  const send = () => {
    const t = text;
    setText('');
    void sendMessage(t);
  };

  const attach = () =>
    Alert.alert('Attach an image', undefined, [
      { text: 'Photo library', onPress: () => void pickImage('library') },
      { text: 'Camera', onPress: () => void pickImage('camera') },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <View style={styles.wrap}>
      {attachment ? (
        <View style={styles.preview}>
          <Image source={{ uri: attachment.uri }} style={styles.thumb} />
          <Text style={styles.previewText}>Image attached — ask about it</Text>
          <Pressable onPress={clearAttachment} hitSlop={10} accessibilityLabel="Remove image">
            <Text style={styles.remove}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.row}>
        <Pressable style={styles.iconBtn} onPress={attach} accessibilityLabel="Attach image" disabled={generating}>
          <Icon name="gallery" size={24} />
        </Pressable>

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={8000}
          editable={!generating}
        />

        {generating ? (
          <Pressable style={[styles.action, styles.stop]} onPress={stopGenerating} accessibilityLabel="Stop">
            <Text style={styles.actionText}>■</Text>
          </Pressable>
        ) : canSend ? (
          <Pressable style={[styles.action, styles.send]} onPress={send} accessibilityLabel="Send">
            <Icon name="send" size={22} color={colors.onAccent} />
          </Pressable>
        ) : (
          <Pressable style={[styles.action, styles.mic]} onPress={() => void toggleVoice()} accessibilityLabel="Start live voice">
            <Icon name="audio" size={24} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderRadius: 22,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
  },
  action: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: colors.text, fontSize: 20 },
  send: { backgroundColor: colors.accent },
  mic: { backgroundColor: colors.accentDim },
  stop: { backgroundColor: colors.danger },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, backgroundColor: colors.surface, borderRadius: 14, padding: 8 },
  thumb: { width: 44, height: 44, borderRadius: 8 },
  previewText: { flex: 1, color: colors.muted, fontSize: 13 },
  remove: { color: colors.muted, fontSize: 18, paddingHorizontal: 6 },
});
