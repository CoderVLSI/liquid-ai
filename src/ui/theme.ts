import { StyleSheet } from 'react-native';

// "Liquid Aurora" palette from the LFM3 Pocket asset pack (palette.json)
export const colors = {
  bg: '#080D1E',
  surface: '#111A30',
  surfaceHi: '#172440',
  border: '#22304f',
  text: '#F6FAFF',
  muted: '#9AAAC4',
  accent: '#27E8F6', // cyan
  accentDim: '#10375a',
  blue: '#487CFF',
  violet: '#9C6AFF',
  good: '#4cd08a',
  warn: '#ffbf47',
  danger: '#ff6b6b',
  dangerDim: '#3a1c2a',
  onAccent: '#04121f',
};

export const mono = { fontFamily: 'monospace' as const };

export const shared = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: colors.surfaceHi,
  },
  pillText: { color: colors.muted, fontSize: 11 },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: colors.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnDanger: { backgroundColor: colors.dangerDim },
  btnText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  btnTextPrimary: { color: colors.onAccent },
  h1: { color: colors.text, fontSize: 20, fontWeight: '700' },
  h2: { color: colors.text, fontSize: 15, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 13 },
});
