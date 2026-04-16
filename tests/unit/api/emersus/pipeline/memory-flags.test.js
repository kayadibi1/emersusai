import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('memory-flags', () => {
  const saved = {};
  const keys = [
    'MEMORY_EXTRACTOR_ENABLED',
    'MEMORY_REMEMBER_FACT_ENABLED',
    'MEMORY_RECALL_ENABLED',
  ];

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('all flags default FALSE when env unset', async () => {
    const m = await import(`../../../../../api/emersus/pipeline/memory-flags.js?cacheBust=${Date.now()}`);
    assert.equal(m.isExtractorEnabled(), false);
    assert.equal(m.isRememberFactEnabled(), false);
    assert.equal(m.isRecallEnabled(), false);
  });

  test('"true" (case-insensitive) enables a flag', async () => {
    process.env.MEMORY_REMEMBER_FACT_ENABLED = 'TRUE';
    const m = await import(`../../../../../api/emersus/pipeline/memory-flags.js?cacheBust=${Date.now()}`);
    assert.equal(m.isRememberFactEnabled(), true);
  });

  test('"1" also enables', async () => {
    process.env.MEMORY_RECALL_ENABLED = '1';
    const m = await import(`../../../../../api/emersus/pipeline/memory-flags.js?cacheBust=${Date.now()}`);
    assert.equal(m.isRecallEnabled(), true);
  });

  test('any other value is FALSE', async () => {
    process.env.MEMORY_EXTRACTOR_ENABLED = 'yes';
    const m = await import(`../../../../../api/emersus/pipeline/memory-flags.js?cacheBust=${Date.now()}`);
    assert.equal(m.isExtractorEnabled(), false);
  });
});
