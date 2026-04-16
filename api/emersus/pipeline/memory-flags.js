// api/emersus/pipeline/memory-flags.js
// Reads the three MEMORY_* kill-switch env vars. Default FALSE per spec §9.8 —
// memory subsystem stays dark until an operator explicitly flips a flag.

function readBool(envValue) {
  if (typeof envValue !== 'string') return false;
  const v = envValue.trim().toLowerCase();
  return v === 'true' || v === '1';
}

export function isExtractorEnabled() {
  return readBool(process.env.MEMORY_EXTRACTOR_ENABLED);
}

export function isRememberFactEnabled() {
  return readBool(process.env.MEMORY_REMEMBER_FACT_ENABLED);
}

export function isRecallEnabled() {
  return readBool(process.env.MEMORY_RECALL_ENABLED);
}
