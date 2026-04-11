// scripts/sources/_registry.js
// Central registry of ingestion + discovery sources.
// Imports are added progressively as adapters are implemented.

const ingestionSources = [];
const discoverySources = [];

/** @param {import('./_types.js').IngestionSource} source */
export function registerIngestion(source) {
  if (ingestionSources.find(s => s.id === source.id)) {
    throw new Error(`duplicate ingestion source id: ${source.id}`);
  }
  ingestionSources.push(source);
}

/** @param {import('./_types.js').DiscoverySource} source */
export function registerDiscovery(source) {
  if (discoverySources.find(s => s.id === source.id)) {
    throw new Error(`duplicate discovery source id: ${source.id}`);
  }
  discoverySources.push(source);
}

export function getIngestionSource(id) {
  return ingestionSources.find(s => s.id === id);
}

export function getDiscoverySource(id) {
  return discoverySources.find(s => s.id === id);
}

export function listIngestionSources() {
  return [...ingestionSources];
}

export function listDiscoverySources() {
  return [...discoverySources];
}
