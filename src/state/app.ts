import { createStore } from './store';
import { DEFAULT_SETTINGS } from './settings';
import type { Settings } from './settings';
import type { SavedChat } from '../chat/saved';
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

export type Sheet = 'none' | 'models' | 'debug' | 'settings' | 'agents' | 'history';

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
  /** the setup wizard is open (it also opens by itself until it was finished once) */
  setupOpen: boolean;
  /** set when the buddy just evolved: the cutscene plays until it is dismissed */
  evolving: { buddyId: string; form: 'stage2' | 'stage3' } | null;
  /** past conversations (the open one is `messages`) */
  chats: SavedChat[];
  /** messages typed while a reply was still being written; they are sent one after another */
  queued: number;
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
  setupOpen: false,
  evolving: null,
  chats: [],
  queued: 0,
});
