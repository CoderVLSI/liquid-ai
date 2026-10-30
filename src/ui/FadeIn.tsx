import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { ms } from './motion';

/** Fades and slides its content in when it first appears. */
export function FadeIn({
  children,
  enabled = true,
  delay = 0,
  y = 10,
  duration = 190,
  style,
}: {
  children: React.ReactNode;
  enabled?: boolean;
  delay?: number;
  y?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(enabled ? 0 : 1)).current;
  useEffect(() => {
    if (!enabled) return;
    Animated.timing(v, { toValue: 1, duration: ms(duration), delay: ms(delay), easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enabled, v, delay, duration]);
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [y, 0] }) }] }]}>{children}</Animated.View>;
}
