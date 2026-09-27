import test from 'node:test';
import assert from 'node:assert/strict';
import { angleDelta, createNoise2D, damp, fbm, mulberry32 } from '../src/core/math.js';

test('damp is frame-rate independent', () => {
  const oneBig = damp(0, 10, 5, 1 / 30);
  const twoSmall = damp(damp(0, 10, 5, 1 / 60), 10, 5, 1 / 60);
  assert.ok(Math.abs(oneBig - twoSmall) < 1e-9);
});

test('angleDelta takes the short way round', () => {
  assert.ok(Math.abs(angleDelta(3.0, -3.0) - (2 * Math.PI - 6)) < 1e-9);
  assert.ok(Math.abs(angleDelta(0, Math.PI / 2) - Math.PI / 2) < 1e-9);
});

test('seeded RNG and noise are deterministic and bounded', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
  const n = createNoise2D(3);
  for (let i = 0; i < 500; i++) {
    const v = fbm(n, i * 0.37, i * -0.21);
    assert.ok(v >= 0 && v <= 1);
  }
});
