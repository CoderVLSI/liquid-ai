import type { ModelDef } from '../models/catalog.ts';
import { has, modelPaths } from '../models/catalog.ts';
import type { Settings } from '../state/settings.ts';
import { pickThreads } from '../state/settings.ts';

/**
 * Command line for llama.cpp's server (b11960+, which knows the lfm3 architecture and /v1/realtime).
 * Flag names were checked against common/arg.cpp of that release.
 */
export function buildServerArgs(model: ModelDef, modelsDir: string, s: Settings, cores: number): string[] {
  const p = modelPaths(modelsDir, model);
  // one slot for chat/voice plus one per agent that may run in parallel; the context is split between them
  const slots = Math.max(2, Math.min(5, s.agentParallel + 1));
  let threads = pickThreads(s.threads, cores);
  // a live voice model must leave CPU cores free for the audio thread, or speech stutters
  if (has(model, 'voice') && s.threads === 0) threads = Math.min(threads, Math.max(2, cores - 4));
  const args = ['-m', p.model];
  if (p.mmproj) args.push('--mmproj', p.mmproj);
  args.push(
    '--host', '127.0.0.1',
    '--port', String(s.port),
    '-c', String(s.contextPerSlot * slots),
    '-np', String(slots),
    '-t', String(threads),
    '--temp', '0',
    '--reasoning', s.thinking ? 'on' : 'off',
    '--no-webui',
  );
  return args;
}
