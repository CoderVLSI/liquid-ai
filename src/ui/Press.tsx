import React, { useRef } from 'react';
import { Animated, Pressable } from 'react-native';
import type { GestureResponderEvent, PressableProps, StyleProp, ViewStyle } from 'react-native';
import { tap } from '../lib/haptics';
import type { HapticKind } from '../lib/haptics';
import { ms } from './motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  /** how far it shrinks while held (1 = not at all) */
  pressScale?: number;
  /** vibration on press; false for none */
  haptic?: HapticKind | false;
}

/**
 * Drop-in Pressable that squeezes while held and springs back, with a small haptic tick.
 * It makes every button feel immediate: the response starts on touch-down, not when the finger lifts.
 */
export function Press({ style, children, pressScale = 0.94, haptic = 'light', onPress, onPressIn, onPressOut, disabled, ...rest }: PressProps) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      style={[style, { transform: [{ scale }] }]}
      onPressIn={(e: GestureResponderEvent) => {
        if (!disabled) Animated.timing(scale, { toValue: pressScale, duration: ms(70), useNativeDriver: true }).start();
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        Animated.spring(scale, { toValue: 1, speed: 40, bounciness: 9, useNativeDriver: true }).start();
        onPressOut?.(e);
      }}
      onPress={(e: GestureResponderEvent) => {
        if (haptic) tap(haptic);
        onPress?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
