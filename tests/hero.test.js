import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/physics/physics.js';
import { Hero, HERO } from '../src/entities/hero.js';
import { Mover } from '../src/world/builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DT = 1 / 60;
// Camera looking down -Z: "forward" input moves the hero toward -Z.
const rig = { basis: (f, r) => { f.set(0, 0, -1); r.set(1, 0, 0); } };

function setup(build) {
  const physics = new PhysicsWorld(null);
  physics.addBox(V(-100, -1, -100), V(100, 0, 100));
  build?.(physics);
  const ctx = { physics, killY: -50, input: null };
  const hero = new Hero();
  hero.spawn(V(0, 0, 0), Math.PI);
  return { physics, ctx, hero };
}

function input(o = {}) {
  return { move: { x: 0, y: 0 }, jump: false, jumpHeld: false, attack: false, crouch: false, crouchPressed: false, ...o };
}

function run(hero, ctx, frames, make) {
  let peak = -Infinity;
  for (let i = 0; i < frames; i++) {
    hero.step(DT, make(i), rig, ctx);
    peak = Math.max(peak, hero.position.y);
  }
  return peak;
}

test('single jump reaches roughly 1.7 m', () => {
  const { ctx, hero } = setup();
  const peak = run(hero, ctx, 90, (i) => input({ jump: i === 0, jumpHeld: i < 40 }));
  assert.ok(peak > 1.5 && peak < 2.1, `peak ${peak}`);
  assert.equal(hero.state, 'move');
});

test('releasing jump early gives a shorter hop', () => {
  const { ctx, hero } = setup();
  const peak = run(hero, ctx, 90, (i) => input({ jump: i === 0, jumpHeld: i < 3 }));
  assert.ok(peak < 1.3, `peak ${peak}`);
});

test('three chained running jumps produce a triple jump', () => {
  const { ctx, hero } = setup();
  const fwd = { move: { x: 0, y: 1 } };
  run(hero, ctx, 60, () => input(fwd)); // build speed
  const states = [];
  let peak3 = 0;
  let jumpsDone = 0;
  let press = true;
  for (let i = 0; i < 400 && jumpsDone < 3; i++) {
    const before = hero.inAir;
    hero.step(DT, input({ ...fwd, jump: press, jumpHeld: true }), rig, ctx);
    if (press) {
      states.push(hero.state);
      jumpsDone++;
    }
    press = before && !hero.inAir; // jump on the frame right after landing
  }
  const base = hero.position.y;
  peak3 = run(hero, ctx, 120, () => input({ ...fwd, jumpHeld: true }));
  assert.deepEqual(states, ['jump1', 'jump2', 'jump3']);
  assert.ok(peak3 - base > 3.5, `triple jump height ${peak3 - base}`);
});

test('crouch-slide into jump is a long jump that covers distance', () => {
  const { ctx, hero } = setup();
  run(hero, ctx, 60, () => input({ move: { x: 0, y: 1 } }));
  const z0 = hero.position.z;
  hero.step(DT, input({ move: { x: 0, y: 1 }, crouch: true, crouchPressed: true }), rig, ctx);
  assert.equal(hero.state, 'slide');
  hero.step(DT, input({ move: { x: 0, y: 1 }, crouch: true, jump: true, jumpHeld: true }), rig, ctx);
  assert.equal(hero.state, 'longjump');
  for (let i = 0; i < 200 && hero.inAir; i++) hero.step(DT, input({ move: { x: 0, y: 1 }, jumpHeld: true }), rig, ctx);
  const dist = z0 - hero.position.z;
  assert.ok(dist > 8, `long jump distance ${dist}`);
});

test('backflip from a crouch goes high and backwards', () => {
  const { ctx, hero } = setup();
  hero.step(DT, input({ crouch: true, crouchPressed: true }), rig, ctx);
  assert.equal(hero.state, 'crouch');
  hero.step(DT, input({ crouch: true, jump: true, jumpHeld: true }), rig, ctx);
  assert.equal(hero.state, 'backflip');
  const peak = run(hero, ctx, 120, () => input({ jumpHeld: true }));
  assert.ok(peak > 3.5, `backflip peak ${peak}`);
  assert.ok(hero.position.z > 1, `moved backwards to z=${hero.position.z}`);
});

test('jumping into a wall and pressing jump performs a wall kick', () => {
  const { ctx, hero } = setup((p) => p.addBox(V(-5, 0, -5), V(5, 10, -4)));
  hero.position.set(0, 0, -1);
  const fwd = { move: { x: 0, y: 1 } };
  run(hero, ctx, 20, () => input(fwd));
  hero.step(DT, input({ ...fwd, jump: true, jumpHeld: true }), rig, ctx);
  let kicked = false;
  for (let i = 0; i < 60 && !kicked; i++) {
    const touching = hero.wallTimer > 0;
    hero.step(DT, input({ ...fwd, jump: touching, jumpHeld: true }), rig, ctx);
    kicked = hero.state === 'wallkick';
  }
  assert.ok(kicked, 'wall kick triggered');
  assert.ok(hero.vy > 10);
  assert.ok(Math.abs(hero.facing) < 0.01, `faces away from the wall, facing=${hero.facing}`);
});

test('ground pound spins, drops and lands with a shockwave', () => {
  const { ctx, hero } = setup();
  hero.step(DT, input({ jump: true, jumpHeld: true }), rig, ctx);
  run(hero, ctx, 15, () => input({ jumpHeld: true }));
  hero.step(DT, input({ crouch: true, crouchPressed: true }), rig, ctx);
  assert.equal(hero.state, 'gpSpin');
  const seen = new Set();
  for (let i = 0; i < 120; i++) {
    hero.step(DT, input({ crouch: true }), rig, ctx);
    seen.add(hero.state);
    if (hero.state === 'gpLand') break;
  }
  assert.ok(seen.has('gp') && seen.has('gpLand'));
  assert.ok(hero.attackSphere(), 'shockwave hitbox active on landing');
  assert.ok(hero.events.includes('pound'));
});

test('spring pads launch the hero', () => {
  const { ctx, hero } = setup((p) => p.addCylinder(0, 0, 0, 0.3, 1, { kind: 'bounce' }));
  hero.position.set(0, 2, 0);
  hero.setState('fall');
  const peak = run(hero, ctx, 120, () => input());
  assert.ok(peak > 6, `bounce peak ${peak}`);
});

test('moving platforms carry the hero', () => {
  const physics = new PhysicsWorld(null);
  const mover = new Mover(physics, { w: 4, h: 0.5, d: 4, path: [V(0, 0, 0), V(10, 0, 0)], speed: 2, wait: 0, visual: false });
  const ctx = { physics, killY: -50 };
  const hero = new Hero();
  hero.spawn(V(0, 0.25, 0), 0);
  for (let i = 0; i < 120; i++) {
    mover.update(DT);
    hero.step(DT, input(), rig, ctx);
  }
  assert.ok(hero.grounded);
  assert.ok(Math.abs(hero.position.x - mover.center.x) < 0.05, `hero ${hero.position.x} vs platform ${mover.center.x}`);
});

test('falling from a great height hurts', () => {
  const { ctx, hero } = setup();
  hero.position.set(0, 20, 0);
  hero.setState('fall');
  hero.peakY = 20;
  run(hero, ctx, 150, () => input());
  assert.equal(hero.health, HERO.maxHealth - 3);
});

test('cylinder colliders block and support the capsule', () => {
  const physics = new PhysicsWorld(null);
  physics.addCylinder(0, 0, 0, 2, 3);
  const side = V(3.2, 0.5, 0);
  physics.resolveCapsule(side, 0.4, 1.4);
  assert.ok(Math.abs(side.x - 3.4) < 1e-6, `pushed to ${side.x}`);
  const top = V(1, 1.9, 0);
  const r = physics.resolveCapsule(top, 0.4, 1.4);
  assert.ok(r.grounded && Math.abs(top.y - 2) < 1e-6);
  const hit = physics.raycast(V(10, 1, 0), V(-1, 0, 0), 20);
  assert.ok(hit && Math.abs(hit.distance - 7) < 1e-6);
});

test('chained wall kicks climb a narrow shaft', () => {
  const { ctx, hero } = setup((p) => {
    p.addBox(V(-2, 0, -2.4), V(2, 14, -1.4));
    p.addBox(V(-2, 0, 1.4), V(2, 14, 2.4));
  });
  hero.spawn(V(0, 0, 0), Math.PI); // facing -Z
  // A perfect player: push toward the wall they're facing, jump on contact.
  let dir = 1; // +1 = forward (-Z)
  hero.step(DT, input({ move: { x: 0, y: dir }, jump: true, jumpHeld: true }), rig, ctx);
  let kicks = 0;
  let maxY = 0;
  for (let i = 0; i < 600; i++) {
    const kick = hero.wallTimer > 0 && hero.inAir;
    if (kick) {
      kicks++;
      dir = -dir;
    }
    hero.step(DT, input({ move: { x: 0, y: dir }, jump: kick, jumpHeld: true }), rig, ctx);
    maxY = Math.max(maxY, hero.position.y);
    if (!hero.inAir && i > 10) break;
  }
  assert.ok(kicks >= 5, `kicks ${kicks}`);
  assert.ok(maxY > 12, `climbed to ${maxY}`);
});

test('a jump pressed just before touching down is not lost (even after a heavy landing)', () => {
  for (const start of ['jump1', 'backflip']) {
    const { ctx, hero } = setup();
    hero.position.set(0, 0.3, 0);
    hero.setState(start);
    hero.vy = -6;
    // Press jump one frame before landing, then release.
    hero.step(DT, input({ jump: true, jumpHeld: true }), rig, ctx);
    let jumped = false;
    for (let i = 0; i < 20 && !jumped; i++) {
      hero.step(DT, input(), rig, ctx);
      jumped = hero.state.startsWith('jump') && hero.vy > 0;
    }
    assert.ok(jumped, `buffered jump after landing from ${start}`);
  }
});

test('a quick tap still gives a real hop', () => {
  const { ctx, hero } = setup();
  const peak = run(hero, ctx, 90, (i) => input({ jump: i === 0, jumpHeld: i === 0 }));
  assert.ok(peak > 0.9, `tap peak ${peak}`);
});
