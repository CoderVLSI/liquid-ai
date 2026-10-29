import type { ModelDef } from '../models/catalog.ts';
import { modelPaths } from '../models/catalog.ts';
import type { Settings } from '../state/settings.ts';
import { pickThreads } from '../state/settings.ts';

/**
 * Command line for llama.cpp's server (b11960+, which knows the lfm3 architecture and /v1/realtime).
 * Flag names were checked against common/arg.cpp of that release.
 */
export function buildServerArgs(model: ModelDef, modelsDir: string, s: Settings, cores: number): string[] {
  const p = modelPaths(modelsDir, model);
  const args = ['-m', p.model];
  if (p.mmproj) args.push('--mmproj', p.mmproj);
  args.push(
    '--host', '127.0.0.1',
    '--port', String(s.port),
    '-c', String(s.contextSize),
    '-np', '2', // one slot for the live voice session, one for typed chat
    '-t', String(pickThreads(s.threads, cores)),
    '--temp', '0',
    '--reasoning', s.thinking ? 'on' : 'off',
    '--no-webui',
  );
  return args;
}
