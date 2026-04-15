import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthUrl, buildAuthUrl, PANELS } from '../../../../shared/auth/url-state.js';

describe('auth url-state', () => {
  test('default panel is login', () => {
    assert.deepEqual(parseAuthUrl(''), { panel: 'login', token: '' });
  });

  test('explicit panels round-trip', () => {
    for (const panel of PANELS) {
      const built = buildAuthUrl({ panel });
      assert.equal(parseAuthUrl(built).panel, panel);
    }
  });

  test('token alone implies invite panel', () => {
    assert.deepEqual(parseAuthUrl('?token=xyz'), { panel: 'invite', token: 'xyz' });
  });

  test('explicit invite + token', () => {
    assert.deepEqual(parseAuthUrl('?panel=invite&token=abc'), { panel: 'invite', token: 'abc' });
  });

  test('rejects unknown panel', () => {
    assert.equal(parseAuthUrl('?panel=fishing').panel, 'login');
  });

  test('build omits default panel + empty token', () => {
    assert.equal(buildAuthUrl({ panel: 'login' }), '');
    assert.equal(buildAuthUrl({ panel: 'forgot' }), '?panel=forgot');
    assert.equal(buildAuthUrl({ panel: 'invite', token: 'x' }), '?panel=invite&token=x');
  });
});
