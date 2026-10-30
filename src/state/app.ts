import { createStore } from './store';
import { DEFAULT_SETTINGS } from './settings';
import type { Settings } from './settings';
import type { VoiceState } from '../voice/VoiceSession';
import type { CrashReport, ExitReason } from '../native';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** a spoken turn (no transcript is available for the user's own speech) */
  voice?: boolean;
  imageUri?: string;
  streaming?: boolean;
  interrupted?: boolean;
  error?: boolean;
  /** shown dimmed; the model's reasoning when "thinking" is enabled */
  reasoning?: string;
  t: number;
}

export type Mode = 'chat' | 'agent';

export type Sheet = 'none' | 'models' | 'debug' | 'settings' | 'agents';

export interface Attachment {
  uri: string;
  dataUri: string;
}

export interface AppState {
  booted: boolean;
  mode: Mode;
  settings: Settings;
  messages: ChatMsg[];
  generating: boolean;
  attachment: Attachment | null;
  voice: { active: boolean; state: VoiceState | 'off'; level: number; muted: boolean };
  sheet: Sheet;
  toast: string | null;
  crashes: CrashReport[];
  exitReasons: ExitReason[];
  nativeMissing: boolean;
}

export const appStore = createStore<AppState>({
  booted: false,
  mode: 'chat',
  settings: DEFAULT_SETTINGS,
  messages: [],
  generating: false,
  attachment: null,
  voice: { active: false, state: 'off', level: 0, muted: false },
  sheet: 'none',
  toast: null,
  crashes: [],
  exitReasons: [],
  nativeMissing: false,
});
