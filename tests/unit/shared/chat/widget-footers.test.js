import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFollowUpPrompt,
  citationLinks,
} from '../../../../shared/chat/widget-footers.js';

describe('widget-footers — follow-up prompt builder', () => {
  test('uses first author surname when available', () => {
    assert.equal(
      buildFollowUpPrompt({
        title: 'Protein intake for hypertrophy',
        authors: ['Morton RW', 'Murphy KT'],
      }),
      'Tell me more about "Protein intake for hypertrophy" by Morton RW.',
    );
  });

  test('falls back to journal when no authors', () => {
    assert.equal(
      buildFollowUpPrompt({
        title: 'Creatine review',
        journal: 'JISSN',
      }),
      'Tell me more about "Creatine review" (JISSN).',
    );
  });

  test('falls back to bare title-only prompt when neither present', () => {
    assert.equal(
      buildFollowUpPrompt({ title: 'Some paper' }),
      'Tell me more about "Some paper".',
    );
  });

  test('returns empty string for missing title', () => {
    assert.equal(buildFollowUpPrompt({ authors: ['A'] }), '');
    assert.equal(buildFollowUpPrompt(null), '');
  });

  test('trims over-long titles', () => {
    const long = 'x'.repeat(400);
    const prompt = buildFollowUpPrompt({ title: long });
    assert.ok(prompt.length < 260);
    assert.match(prompt, /…"\.$/);
  });
});

describe('widget-footers — citation link resolver', () => {
  test('PubMed source with real pmid → PUBMED link', () => {
    const links = citationLinks({ source: 'pubmed', pmid: 12345678 });
    assert.equal(links.length, 1);
    assert.equal(links[0].label, 'PUBMED');
    assert.match(links[0].href, /pubmed\.ncbi\.nlm\.nih\.gov\/12345678/);
  });

  test('source with DOI → DOI link', () => {
    const links = citationLinks({ source: 'openalex', doi: '10.1/foo' });
    assert.equal(links.length, 1);
    assert.equal(links[0].label, 'DOI');
    assert.match(links[0].href, /doi\.org\/10\.1\/foo$/);
  });

  test('PubMed with both pmid and doi → both links (PUBMED first)', () => {
    const links = citationLinks({ source: 'pubmed', pmid: 999, doi: '10.1/foo' });
    assert.deepEqual(links.map((l) => l.label), ['PUBMED', 'DOI']);
  });

  test('source with nothing → no links', () => {
    assert.deepEqual(citationLinks({ source: 'unknown' }), []);
    assert.deepEqual(citationLinks(null), []);
  });

  test('synthetic pmid (≥ 10^10) is NOT treated as PubMed', () => {
    const links = citationLinks({ source: 'pubmed', pmid: 10000000001, doi: '10.1/x' });
    // Only DOI should remain — the synthetic pmid is not a real PubMed id.
    assert.deepEqual(links.map((l) => l.label), ['DOI']);
  });
});
