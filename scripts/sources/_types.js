// scripts/sources/_types.js
// Documentation-only: interface definitions as JSDoc typedefs.
// JS doesn't enforce interfaces, but adapters that deviate from this
// shape will fail at first registry use.

/**
 * @typedef {Object} DiscoveryFeedRow
 * @property {string} id
 * @property {string} name
 * @property {'rss'|'atom'|'api'} kind
 * @property {string} url
 * @property {string} source_plugin
 * @property {Date|null} last_item_at
 */

/**
 * @typedef {Object} DiscoveredItem
 * @property {string} url
 * @property {string} title
 * @property {string|null} abstract
 * @property {Date} publishedAt
 * @property {string} feedId
 */

/**
 * @typedef {Object} IngestOpts
 * @property {number} target
 * @property {AbortSignal} [signal]
 * @property {(msg: string, level?: 'info'|'warn'|'error') => Promise<void>} [progress]
 */

/**
 * @typedef {Object} IngestedPaper
 * @property {string} externalId
 * @property {string} source
 * @property {string} title
 * @property {string|null} abstract
 * @property {string|null} doi
 * @property {Date|null} publishedAt
 * @property {string|null} journal
 * @property {string[]} authors
 * @property {boolean} peerReviewed
 * @property {object} sourceMetadata
 */

/**
 * @typedef {Object} DiscoverySource
 * @property {string} id
 * @property {string} name
 * @property {'rss'|'atom'|'api'} kind
 * @property {(feed: DiscoveryFeedRow) => Promise<DiscoveredItem[]>} fetchNew
 */

/**
 * @typedef {Object} IngestionSource
 * @property {string} id
 * @property {string} name
 * @property {boolean} peerReviewed
 * @property {(query: string, opts: IngestOpts) => AsyncIterable<IngestedPaper>} fetchPapers
 */

export {}; // module marker
