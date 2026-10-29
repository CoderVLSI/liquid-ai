import type { ModelId } from '../models/catalog.ts';

export interface Settings {
  activeModel: ModelId | null;
  systemPrompt: string;
  voicePrompt: string;
  /** 0 = pick automatically from the CPU core count */
  threads: number;
  /** context window of each conversation slot (chat, voice and every parallel agent get one) */
  contextPerSlot: number;
  thinking: boolean;
  /** 'text+audio' shows live captions while it speaks */
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
  activeModel: null,
  systemPrompt: 'You are a helpful, concise assistant running privately on the user\'s phone.',
  voicePrompt:
    'You are a friendly voice assistant. Answer in short, natural spoken sentences. Do not use lists, markdown or emojis.',
  threads: 0,
  contextPerSlot: 6144,
  thinking: false,
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
