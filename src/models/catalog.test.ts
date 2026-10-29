import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, getModel, hfUrl, modelPaths, totalBytes, pickDefaultModel, has, formatBytes } from './catalog.ts';

test('there are exactly four downloadable models', () => {
  assert.equal(MODELS.length, 4);
  assert.deepEqual(MODELS.map((m) => m.id).sort(), ['audio', 'omni', 'text', 'vl']);
});

test('every model has weights and multimodal ones have a projector', () => {
  for (const m of MODELS) {
    assert.ok(m.files.some((f) => f.role === 'model'), m.id);
    const needsProjector = has(m, 'voice') || has(m, 'vision');
    assert.equal(m.files.some((f) => f.role === 'mmproj'), needsProjector, m.id);
  }
});

test('urls and paths are well formed', () => {
  const omni = getModel('omni');
  assert.equal(
    hfUrl(omni.repo, omni.files[0].name),
    'https://huggingface.co/LiquidAI/LFM3-Omni-2B-GGUF/resolve/main/LFM3-Omni-2B-Q4_0.gguf',
  );
  const p = modelPaths('/data/files/models/', omni);
  assert.equal(p.model, '/data/files/models/omni/LFM3-Omni-2B-Q4_0.gguf');
  assert.equal(p.mmproj, '/data/files/models/omni/mmproj-LFM3-Omni-2B-Q8_0.gguf');
  assert.equal(modelPaths('/m', getModel('text')).mmproj, undefined);
});

test('sizes add up to roughly the advertised download', () => {
  assert.ok(totalBytes(getModel('omni')) > 1.5e9 && totalBytes(getModel('omni')) < 1.6e9);
  assert.equal(formatBytes(1049617920), '1.05 GB');
  assert.equal(formatBytes(203031872), '203 MB');
});

test('default model prefers the most capable one that is installed', () => {
  assert.equal(pickDefaultModel([]), null);
  assert.equal(pickDefaultModel(['text', 'vl']), 'vl');
  assert.equal(pickDefaultModel(['text', 'omni', 'audio']), 'omni');
});
