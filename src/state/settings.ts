import type { ModelId } from '../models/catalog.ts';
import type { McpServerConfig } from '../mcp/types.ts';

export type Tone = 'friendly' | 'concise' | 'formal';

export interface Settings {
  // ---- who the user and their buddy are (first-run setup) ----
  /** the first-run setup has been completed or skipped */
  onboarded: boolean;
  userName: string;
  /** what the user calls their assistant */
  agentName: string;
  /** free text: what the user wants help with */
  goals: string;
  /** topics picked in setup */
  interests: string[];
  tone: Tone;
  /** IANA name like Asia/Kolkata, or 'auto' for the phone's own zone */
  timezone: string;
  /** id of the chosen mascot ('orb' is the built-in one) */
  buddy: string;
  /** evolution: XP per buddy id, the streak of active days, and Mega state */
  buddyXp: Record<string, number>;
  streak: number;
  lastActiveDay: string;
  /** epoch ms until which the Mega form lasts (0 = not active) */
  megaUntil: number;
  /** Mega charges spent so far */
  megaUsed: number;
  /** MCP servers and remote computers the agent may use */
  mcpServers: McpServerConfig[];

  activeModel: ModelId | null;
  systemPrompt: string;
  voicePrompt: string;
  /** 0 = pick automatically from the CPU core count */
  threads: number;
  /** context window of each conversation slot (chat, voice and every parallel agent get one) */
  contextPerSlot: number;
  thinking: boolean;
  /**
   * Who speaks the reply. 'phone' = the model only writes text and the phone's own speech engine says it (smooth on
   * any phone, instant). 'lfm' = the model generates the audio itself (natural, but stutters when the phone cannot
   * generate speech faster than real time).
   */
  voiceOutput: 'phone' | 'lfm';
  /** speed of the phone voice, 1 = normal */
  ttsRate: number;
  /** a small buzz on taps and when a reply arrives */
  haptics: boolean;
  /** 'text+audio' shows live captions while it speaks (LFM voice only) */
  speechReply: 'text+audio' | 'audio';
  bargeIn: boolean;
  /** allow interrupting while the assistant plays through the loudspeaker (it can hear itself; headphones are safe) */
  bargeInOnSpeaker: boolean;
  /** jitter buffer before speech starts playing, ms */
  voiceBufferMs: number;
  /** raise/lower the buffer automatically depending on stutter */
  voiceAutoBuffer: boolean;
  /** Android "call" audio mode: enables the platform echo canceller */
  callMode: boolean;
  vadSensitivity: number;
  silenceMs: number;
  /** stop the model server after this many minutes in the background (0 = never) */
  idleStopMinutes: number;
  port: number;
  /** let agents use the internet (search + reading pages) */
  agentWeb: boolean;
  /** max model calls per agent task before it must wrap up */
  agentMaxSteps: number;
  /** how many agent tasks may run at the same time (the swarm size) */
  agentParallel: number;
  /** ask before an agent posts, sends or creates something outside the phone */
  confirmWrites: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  userName: '',
  agentName: 'Pocket',
  goals: '',
  interests: [],
  tone: 'friendly',
  timezone: 'auto',
  buddy: 'orb',
  buddyXp: {},
  streak: 0,
  lastActiveDay: '',
  megaUntil: 0,
  megaUsed: 0,
  mcpServers: [],
  activeModel: null,
  systemPrompt: 'You are a helpful, concise assistant running privately on the user\'s phone.',
  voicePrompt:
    'You are a friendly voice assistant. Answer in short, natural spoken sentences. Do not use lists, markdown or emojis.',
  threads: 0,
  contextPerSlot: 6144,
  thinking: false,
  voiceOutput: 'phone',
  ttsRate: 1,
  haptics: true,
  speechReply: 'audio',
  bargeIn: true,
  bargeInOnSpeaker: false,
  voiceBufferMs: 900,
  voiceAutoBuffer: true,
  callMode: true,
  vadSensitivity: 0.55,
  silenceMs: 800,
  idleStopMinutes: 5,
  port: 18080,
  agentWeb: true,
  agentMaxSteps: 10,
  agentParallel: 3,
  confirmWrites: true,
};

export function mergeSettings(saved: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!saved || typeof saved !== 'object') return out;
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = (saved as Record<string, unknown>)[k];
    if (v === undefined || v === null && k !== 'activeModel') continue;
    if (typeof v === typeof DEFAULT_SETTINGS[k] || (k === 'activeModel' && (v === null || typeof v === 'string'))) {
      (out as any)[k] = v;
    }
  }
  return out;
}

/** Threads for token generation: big + mid cores, leave the little ones for the UI and audio. */
export function pickThreads(configured: number, cores: number): number {
  if (configured > 0) return configured;
  return Math.max(2, Math.min(6, Math.round(cores * 0.6)));
}
