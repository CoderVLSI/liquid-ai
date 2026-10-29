// The four LFM3 models offered for on-demand download.
// Repos, file names and byte sizes were read from the Hugging Face API (LiquidAI/*-GGUF).
// Q4_0 is the quantization Liquid benchmarks on-device (it also gets repacked for fast Arm CPU kernels).

export type ModelId = 'omni' | 'audio' | 'vl' | 'text';
export type Capability = 'text' | 'voice' | 'vision';

export interface ModelFile {
  role: 'model' | 'mmproj';
  name: string;
  bytes: number;
}

export interface ModelDef {
  id: ModelId;
  name: string;
  tagline: string;
  description: string;
  repo: string;
  files: ModelFile[];
  capabilities: Capability[];
}

export const MODELS: ModelDef[] = [
  {
    id: 'omni',
    name: 'LFM3-Omni 2B',
    tagline: 'Voice + vision + text',
    description: 'Sees, listens and talks back. The best choice for live voice with pictures.',
    repo: 'LiquidAI/LFM3-Omni-2B-GGUF',
    files: [
      { role: 'model', name: 'LFM3-Omni-2B-Q4_0.gguf', bytes: 1049617920 },
      { role: 'mmproj', name: 'mmproj-LFM3-Omni-2B-Q8_0.gguf', bytes: 506842528 },
    ],
    capabilities: ['text', 'voice', 'vision'],
  },
  {
    id: 'audio',
    name: 'LFM3-Audio 2B',
    tagline: 'Live voice + text',
    description: 'Speech in, speech out, 18 languages, tool calling. Smaller than Omni.',
    repo: 'LiquidAI/LFM3-Audio-2B-GGUF',
    files: [
      { role: 'model', name: 'LFM3-Audio-2B-Q4_0.gguf', bytes: 1049613856 },
      { role: 'mmproj', name: 'mmproj-LFM3-Audio-2B-Q8_0.gguf', bytes: 303811840 },
    ],
    capabilities: ['text', 'voice'],
  },
  {
    id: 'vl',
    name: 'LFM3-VL 2B',
    tagline: 'Images + text',
    description: 'Vision-language model: photos, charts, documents, OCR. No voice.',
    repo: 'LiquidAI/LFM3-VL-2B-GGUF',
    files: [
      { role: 'model', name: 'LFM3-VL-2B-QAD-Q4_0.gguf', bytes: 1049615648 },
      { role: 'mmproj', name: 'mmproj-LFM3-VL-2B-Q8_0.gguf', bytes: 203031872 },
    ],
    capabilities: ['text', 'vision'],
  },
  {
    id: 'text',
    name: 'LFM3 1.7B',
    tagline: 'Fast text chat',
    description: 'The text-only base of the family. Smallest and fastest.',
    repo: 'LiquidAI/LFM3-1.7B-GGUF',
    files: [{ role: 'model', name: 'LFM3-1.7B-QAD-Q4_0.gguf', bytes: 1049615680 }],
    capabilities: ['text'],
  },
];

/** Priority used to pick a default when several models are downloaded. */
export const DEFAULT_ORDER: ModelId[] = ['omni', 'audio', 'vl', 'text'];

export function getModel(id: ModelId): ModelDef {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown model ${id}`);
  return m;
}

export function hfUrl(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file}`;
}

export function totalBytes(m: ModelDef): number {
  return m.files.reduce((a, f) => a + f.bytes, 0);
}

export function filePath(modelsDir: string, m: ModelDef, f: ModelFile): string {
  return `${modelsDir.replace(/\/$/, '')}/${m.id}/${f.name}`;
}

export function modelPaths(modelsDir: string, m: ModelDef): { model: string; mmproj?: string } {
  const model = m.files.find((f) => f.role === 'model');
  const mmproj = m.files.find((f) => f.role === 'mmproj');
  if (!model) throw new Error(`model ${m.id} has no weights file`);
  return {
    model: filePath(modelsDir, m, model),
    mmproj: mmproj ? filePath(modelsDir, m, mmproj) : undefined,
  };
}

export function has(m: ModelDef, c: Capability): boolean {
  return m.capabilities.includes(c);
}

export function pickDefaultModel(ready: ModelId[]): ModelId | null {
  for (const id of DEFAULT_ORDER) if (ready.includes(id)) return id;
  return null;
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}
