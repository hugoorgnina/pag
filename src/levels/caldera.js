import * as THREE from 'three';
import { createLava } from '../render/shaders/effects.js';
import { FireBar, Flyer, Walker } from '../entities/enemies.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Caldera Ardiente: basalt islands in a lava sea. Touching lava launches you
 * with a burn. Stars: the volcano's crown, eight red coins over the lava, and
 * an islet guarded by fire bars.
 */
export function buildCaldera(ctx) {
  const { b, scene } = ctx;
  ctx.lavaY = 0;
  ctx.killY = -10;
  ctx.cameraFloor = 0.2;
  ctx.spawn = V(0, 2.5, 26);
  ctx.spawnFacing = Math.PI;
  const lava = createLava(700, 0);
  scene.add(lava);
  ctx.animated.push(lava.material);
  const glow = new THREE.HemisphereLight(0xff7a3d, 0xff3000, 0.6);
  scene.add(glow);

  const rock = (x, top, z, r) => b.column(x, -3, z, r, top + 3, { mat: 'basalt', radial: Math.max(10, Math.round(r * 6)) });

  rock(0, 2.5, 24, 6);
  ctx.coins.ring(0, 3.4, 24, 3, 8);
  ctx.addStar('cal-rojas', V(0, 4.2, 20.5), { hidden: true });
  ctx.onRedCoins = () => ctx.revealStar('cal-rojas');

  // West route to the volcano.
  rock(-4, 2.0, 16, 2.2);
  rock(-8, 2.8, 10, 2);
  b.mover({ w: 3, h: 0.5, d: 3, mat: 'metal', path: [V(-8, 2.6, 5.5), V(-8, 2.6, -6)], speed: 2.4 });
  rock(-6, 3.0, -11, 3);
  rock(-4, 3.5, -17.5, 1.6);
  ctx.hazards.push(new FireBar(ctx, V(-6, 3.5, -11), { length: 4, speed: 1.5 }));

  // Volcano tiers with steps between them.
  const vx = 0;
  const vz = -30;
  const tiers = [[12, 4], [8.5, 8], [6, 12], [3.8, 15]];
  let prevTop = -3;
  for (const [r, top] of tiers) {
    b.column(vx, prevTop, vz, r, top - prevTop, { mat: 'basalt', radial: Math.round(r * 5) + 8 });
    prevTop = top;
  }
  const stepsAt = [
    [8.5 + 1.2, 4, 5.3, 0.4], [8.5 + 1.2, 4, 6.6, 0.9],
    [6 + 1.1, 8, 9.3, 2.6], [6 + 1.1, 8, 10.6, 3.1],
    [3.8 + 1.1, 12, 13.3, 4.4],
  ];
  for (const [r, base, top, a] of stepsAt) {
    b.column(vx + Math.cos(a) * r, base, vz + Math.sin(a) * r, 1.1, top - base, { mat: 'stone', radial: 12 });
  }
  ctx.addStar('cal-volcan', V(vx, 16.5, vz));
  ctx.coins.ring(vx, 4.9, vz, 10.5, 14);
  ctx.coins.ring(vx, 8.9, vz, 7.3, 10);
  ctx.coins.ring(vx, 12.9, vz, 4.9, 8);
  ctx.hazards.push(new FireBar(ctx, V(vx - 6.5, 8.5, vz + 2), { length: 3, speed: -1.8 }));
  ctx.addEnemy(new Walker(ctx, V(vx + 9, 4.2, vz - 5), { color: 0xd4502a, cap: 0x5a1a10, speed: 1.3 }));
  ctx.addEnemy(new Walker(ctx, V(vx - 5, 8.2, vz - 5), { color: 0xd4502a, cap: 0x5a1a10, speed: 1.3 }));
  ctx.addEnemy(new Flyer(ctx, V(vx, 14, vz + 4), { radius: 9 }));

  // East route to the fire-bar islet.
  rock(6, 2.2, 16, 2);
  rock(12, 2.6, 10, 2.4);
  b.mover({ w: 3, h: 0.5, d: 3, mat: 'metal', path: [V(16, 2.5, 5), V(28, 2.5, -1)], speed: 2.8 });
  const ix = 34;
  const iz = -6;
  rock(ix, 3, iz, 6.5);
  ctx.hazards.push(new FireBar(ctx, V(ix, 3.5, iz), { length: 7, speed: 1.1 }));
  ctx.hazards.push(new FireBar(ctx, V(ix - 4, 3.5, iz + 4), { length: 3, speed: -2.2, phase: 1 }));
  ctx.hazards.push(new FireBar(ctx, V(ix + 4, 3.5, iz - 4), { length: 3, speed: -2.2, phase: 2.5 }));
  ctx.addStar('cal-fuego', V(ix, 5.4, iz));
  ctx.addEnemy(new Walker(ctx, V(12, 2.8, 10), { color: 0xd4502a, cap: 0x5a1a10 }));
  ctx.addEnemy(new Flyer(ctx, V(22, 7, 4), { radius: 6 }));

  // Red coins on thin pillars and above the lava.
  const pillars = [[-11, 3.2, 17], [4, 2.8, 5], [-12, 3.6, -2], [10, 3.4, -14], [20, 3.8, 12], [26, 4.2, -12], [-14, 4.4, -24], [15, 4.6, -26]];
  for (const [x, top, z] of pillars) {
    b.column(x, -3, z, 0.9, top + 3, { mat: 'stone', radial: 10 });
    ctx.coins.add(x, top + 0.9, z, 'red');
  }
  // Stepping pillars so each red coin is reachable.
  for (const [x, top, z] of [[-8, 2.4, 14], [2, 2.4, 11], [2, 2.8, -1], [-12, 3.0, 3], [6, 3.2, -18], [16, 3.2, 17], [22, 3.6, -10], [-10, 3.8, -18], [10, 4.2, -22]]) {
    b.column(x, -3, z, 1.2, top + 3, { mat: 'basalt', radial: 10 });
  }

  // Ambient embers rising from the lava near the hero.
  let emberTimer = 0;
  ctx.updaters.push((dt) => {
    emberTimer -= dt;
    if (emberTimer > 0) return;
    emberTimer = 0.15;
    const h = ctx.hero.position;
    const a = Math.random() * Math.PI * 2;
    const r = 4 + Math.random() * 14;
    ctx.particles.burst(V(h.x + Math.cos(a) * r, 0.2, h.z + Math.sin(a) * r), { count: 2, speed: 1, color: 0xff7a2a, up: 3, gravity: -1, life: 2 });
  });
}
