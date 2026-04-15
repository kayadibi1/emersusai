import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeThreadAsMarkdown,
  buildShareUrl,
  formatExpiryLabel,
} from '../../../../shared/chat/share-modal.js';

describe('share-modal — thread serializer', () => {
  test('renders title + messages with role prefixes', () => {
    const md = serializeThreadAsMarkdown({
      title: 'Creatine loading',
      messages: [
        { role: 'user', text: 'Is creatine loading worth it?' },
        { role: 'assistant', text: 'Short answer: not strictly required.', sources: [] },
      ],
    });
    assert.match(md, /^# Creatine loading/);
    assert.match(md, /\*\*You\*\*:/);
    assert.match(md, /\*\*Emersus\*\*:/);
    assert.match(md, /Is creatine loading worth it\?/);
  });

  test('handles missing title with a neutral default', () => {
    const md = serializeThreadAsMarkdown({ messages: [{ role: 'user', text: 'x' }] });
    assert.match(md, /^# Conversation/);
  });

  test('falls back to plainText when text is missing', () => {
    const md = serializeThreadAsMarkdown({
      messages: [{ role: 'assistant', plainText: 'fallback body' }],
    });
    assert.match(md, /fallback body/);
  });

  test('strips widget fences (workout-plan / meal-plan / widget) from assistant prose', () => {
    const md = serializeThreadAsMarkdown({
      messages: [
        {
          role: 'assistant',
          text: 'Here is a plan.\n\n```workout-plan\n{"title":"x"}\n```\n\nFollow it.',
        },
      ],
    });
    assert.doesNotMatch(md, /workout-plan/i);
    assert.match(md, /Here is a plan\./);
    assert.match(md, /Follow it\./);
  });

  test('appends a Sources section when the last assistant has sources', () => {
    const md = serializeThreadAsMarkdown({
      messages: [
        { role: 'user', text: 'q' },
        {
          role: 'assistant',
          text: 'answer',
          sources: [{ title: 'Paper A', year: 2020, authors: ['Smith J'] }],
        },
      ],
    });
    assert.match(md, /## Sources/);
    assert.match(md, /Paper A/);
  });

  test('empty thread → empty string', () => {
    assert.equal(serializeThreadAsMarkdown({}), '');
    assert.equal(serializeThreadAsMarkdown({ messages: [] }), '');
    assert.equal(serializeThreadAsMarkdown(null), '');
  });
});

describe('share-modal — share URL builder', () => {
  test('builds a /share/t/<token> URL from an origin', () => {
    assert.equal(
      buildShareUrl('https://emersus.ai', 'abc123'),
      'https://emersus.ai/share/t/abc123',
    );
  });

  test('strips trailing slash from origin', () => {
    assert.equal(
      buildShareUrl('https://emersus.ai/', 'abc123'),
      'https://emersus.ai/share/t/abc123',
    );
  });

  test('returns empty string for missing token', () => {
    assert.equal(buildShareUrl('https://emersus.ai', ''), '');
    assert.equal(buildShareUrl('https://emersus.ai', null), '');
  });
});

describe('share-modal — expiry label', () => {
  test('formats full days remaining', () => {
    const now = new Date('2026-04-15T00:00:00Z');
    assert.equal(formatExpiryLabel('2026-05-15T00:00:00Z', now), 'expires in 30 days');
  });

  test('formats single day', () => {
    const now = new Date('2026-04-15T00:00:00Z');
    assert.equal(formatExpiryLabel('2026-04-16T00:00:00Z', now), 'expires in 1 day');
  });

  test('formats hours for sub-day windows', () => {
    const now = new Date('2026-04-15T00:00:00Z');
    assert.equal(formatExpiryLabel('2026-04-15T06:00:00Z', now), 'expires in 6 hours');
  });

  test('handles expired', () => {
    const now = new Date('2026-04-15T00:00:00Z');
    assert.equal(formatExpiryLabel('2026-04-14T00:00:00Z', now), 'expired');
  });

  test('null / invalid dates → empty string', () => {
    assert.equal(formatExpiryLabel(null, new Date()), '');
    assert.equal(formatExpiryLabel('not a date', new Date()), '');
  });
});
