import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateProfilePatch, computeMacrosFromBodyWeight } from '../../../../api/emersus/profile.js';

describe('profile — validateProfilePatch', () => {
  test('empty body rejected', () => {
    assert.equal(validateProfilePatch(null).error, 'Body must be an object.');
  });

  test('passes through allowed fields', () => {
    const v = validateProfilePatch({
      goal: 'hypertrophy',
      experience_level: 'intermediate',
      body_weight_kg: 78,
      training_env: 'commercial',
    });
    assert.deepEqual(v.patch, {
      goal: 'hypertrophy',
      experience_level: 'intermediate',
      body_weight_kg: 78,
      training_env: 'commercial',
    });
  });

  test('rejects unknown enum values', () => {
    assert.match(validateProfilePatch({ goal: 'fishing' }).error, /goal must be/);
    assert.match(validateProfilePatch({ experience_level: 'guru' }).error, /experience_level/);
    assert.match(validateProfilePatch({ training_env: 'space-station' }).error, /training_env/);
  });

  test('clamps body_weight_kg + height_cm', () => {
    assert.equal(validateProfilePatch({ body_weight_kg: 999 }).patch.body_weight_kg, 300);
    assert.equal(validateProfilePatch({ height_cm: 50 }).patch.height_cm, 100);
  });

  test('macros set stamps macros_overridden_at', () => {
    const v = validateProfilePatch({ macros: { kcal: 2200, protein_g: 140, carbs_g: 230, fat_g: 70 } });
    assert.deepEqual(v.patch.macros, { kcal: 2200, protein_g: 140, carbs_g: 230, fat_g: 70 });
    assert.match(v.patch.macros_overridden_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('macros=null clears overridden_at', () => {
    const v = validateProfilePatch({ macros: null });
    assert.equal(v.patch.macros, null);
    assert.equal(v.patch.macros_overridden_at, null);
  });

  test('preferences must be object', () => {
    assert.equal(validateProfilePatch({ preferences: { metric_units: true } }).patch.preferences.metric_units, true);
    assert.match(validateProfilePatch({ preferences: 'no' }).error, /preferences/);
  });

  test('equipment must be array, capped at 100 items', () => {
    const big = Array(150).fill('x');
    assert.equal(validateProfilePatch({ equipment: big }).patch.equipment.length, 100);
    assert.match(validateProfilePatch({ equipment: 'no' }).error, /equipment/);
  });
});

describe('profile — computeMacrosFromBodyWeight', () => {
  test('78 kg → 2496 kcal / 140 P / 70 F / ~285 C', () => {
    const m = computeMacrosFromBodyWeight(78);
    assert.equal(m.protein_g, 140);
    assert.equal(m.fat_g, 70);
    assert.equal(m.kcal, 2496);
    // carbs derived from remaining kcal: 2496 - 140*4 - 70*9 = 2496 - 560 - 630 = 1306; /4 = 326.5 → rounds to 327
    assert.equal(m.carbs_g, 327);
  });

  test('null/zero/negative input returns null', () => {
    assert.equal(computeMacrosFromBodyWeight(null), null);
    assert.equal(computeMacrosFromBodyWeight(0), null);
    assert.equal(computeMacrosFromBodyWeight(-10), null);
    assert.equal(computeMacrosFromBodyWeight('not a number'), null);
  });
});
