import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthUrl, buildAuthUrl, PANELS } from '../../../../shared/auth/url-state.js';

describe('auth url-state', () => {
  test('default panel is login', () => {
    assert.deepEqual(parseAuthUrl(''), { panel: 'login' });
  });

  test('explicit panels round-trip', () => {
    for (const panel of PANELS) {
      const built = buildAuthUrl({ panel });
      assert.equal(parseAuthUrl(built).panel, panel);
    }
  });

  test('rejects unknown panel', () => {
    assert.equal(parseAuthUrl('?panel=fishing').panel, 'login');
  });

  test('build omits default panel', () => {
    assert.equal(buildAuthUrl({ panel: 'login' }), '');
    assert.equal(buildAuthUrl({ panel: 'forgot' }), '?panel=forgot');
    assert.equal(buildAuthUrl({ panel: 'signup' }), '?panel=signup');
  });

  test('PANELS contains login, signup, forgot', () => {
    assert.deepEqual(PANELS.sort(), ['forgot', 'login', 'signup']);
  });
});
