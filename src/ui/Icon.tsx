import React from 'react';
import { Image } from 'react-native';
import type { ImageStyle, StyleProp } from 'react-native';

// Metro needs static require() calls, hence the explicit map.
const SOURCES = {
  audio: require('../../assets/icons/audio.png'),
  back: require('../../assets/icons/back.png'),
  bolt: require('../../assets/icons/bolt.png'),
  camera: require('../../assets/icons/camera.png'),
  chat: require('../../assets/icons/chat.png'),
  check: require('../../assets/icons/check.png'),
  chip: require('../../assets/icons/chip.png'),
  download: require('../../assets/icons/download.png'),
  gallery: require('../../assets/icons/gallery.png'),
  models: require('../../assets/icons/models.png'),
  offline: require('../../assets/icons/offline.png'),
  omni: require('../../assets/icons/omni.png'),
  plus: require('../../assets/icons/plus.png'),
  privacy: require('../../assets/icons/privacy.png'),
  send: require('../../assets/icons/send.png'),
  settings: require('../../assets/icons/settings.png'),
  sparkles: require('../../assets/icons/sparkles.png'),
  vision: require('../../assets/icons/vision.png'),
  waveform: require('../../assets/icons/waveform.png'),
} as const;

export type IconName = keyof typeof SOURCES;

/** Line icons from the asset pack (cyan by default). `color` re-tints them. */
export function Icon({ name, size = 24, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<ImageStyle> }) {
  return <Image source={SOURCES[name]} style={[{ width: size, height: size }, color ? { tintColor: color } : null, style]} resizeMode="contain" />;
}
