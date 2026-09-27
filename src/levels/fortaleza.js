import * as THREE from 'three';
import { cylinderGeometry, surface } from '../world/builder.js';
import { Flyer, Walker } from '../entities/enemies.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Fortaleza Celeste: floating platforms over the void. Stars: the keep's
 * summit (spiral steps), eight red coins across a chain of clouds, and a
 * narrow shaft that can only be climbed with wall kicks.
 */
export function buildFortaleza(ctx) {
  const { b, scene } = ctx;
  ctx.killY = -25;
  ctx.spawn = V(0, 0, 3);
  ctx.spawnFacing = Math.PI;

  const island = (x, top, z, r, { mat = 'dirt', topMat = 'grass', depth = 4 } = {}) => {
    b.column(x, top - depth, z, r, depth, { mat, top: topMat, radial: Math.max(12, Math.round(r * 6)) });
    const under = new THREE.Mesh(cylinderGeometry(r * 0.25, depth * 1.4, 16, r * 0.98), surface('stone', 0x9a8f80));
    under.position.set(x, top - depth - depth * 0.7, z);
    scene.add(under);
  };
  const cloud = (x, top, z, r = 1.8) => b.column(x, top - 0.8, z, r, 0.8, { mat: 'cloud', radial: 18 });

  // Start island with a spring pad to a high cloud.
  island(0, 0, 0, 7);
  b.pad(4, 0, 2);
  cloud(6, 6.8, -2);
  ctx.coins.add(6, 7.7, -2, 'red');
  ctx.coins.line(V(0, 0.9, -2), V(0, 0.9, -6), 3);

  // Stepping stones and a moving platform to island B.
  const stones = [[0, 0.6, -10.5], [2.5, 1.3, -15], [-0.5, 2.0, -19.5]];
  stones.forEach(([x, top, z], i) => {
    b.column(x, top - 3, z, 1.6, 3, { mat: 'stone', top: 'grass', radial: 16 });
    if (i === 2) ctx.coins.add(x, top + 0.9, z, 'red');
    else ctx.coins.add(x, top + 0.9, z);
  });
  b.mover({ w: 3, h: 0.5, d: 3, path: [V(-0.5, 2.3, -24), V(-0.5, 2.3, -35)], speed: 2.6, top: 'checkerBlue' });
  ctx.coins.add(-0.5, 3.9, -29.5, 'red');

  // Island B.
  b.platform(0, 0, -44, 14, 3, 14);
  ctx.coins.ring(0, 3.9, -44, 4, 8);
  ctx.addEnemy(new Walker(ctx, V(3, 3.2, -46)));
  ctx.addEnemy(new Walker(ctx, V(-3, 3.2, -41)));
  ctx.addStar('fort-rojas', V(0, 4.6, -44), { hidden: true });
  ctx.onRedCoins = () => ctx.revealStar('fort-rojas');

  // Cloud chain east of island B with red coins.
  const clouds = [[10, 4.2, -44], [15, 5.2, -40], [19, 6.2, -35, true], [22, 5.4, -29], [24, 4.6, -22, true]];
  for (const [x, top, z, red] of clouds) {
    cloud(x, top, z);
    ctx.coins.add(x, top + 0.9, z, red ? 'red' : 'yellow');
  }
  b.mover({ w: 2.6, h: 0.5, d: 2.6, mat: 'cloud', path: [V(24, 4.2, -17), V(24, 4.2, -6)], speed: 2.2 });
  cloud(22, 4.8, -1);
  ctx.coins.add(22, 5.7, -1, 'red');
  cloud(14, 3.2, 2);
  cloud(8, 1.8, 4);
  ctx.addEnemy(new Flyer(ctx, V(18, 8, -38), { radius: 5 }));
  ctx.addEnemy(new Flyer(ctx, V(16, 7, -12), { radius: 6 }));

  // Stairs from island B up to the fortress.
  for (let i = 0; i < 6; i++) b.block(-7.6 - i * 1.2, 2, -44, 1.2, 1 + (i + 1) * 0.6, 3, { mat: 'stone' });

  // Fortress floor and walls (gate on the east side).
  const fx = -23.5;
  const fz = -44;
  const floor = 7;
  b.platform(fx, 3, fz, 18, 4, 18, { top: 'checker', side: 'stone' });
  const wallH = 4;
  b.block(fx, floor, fz - 8.5, 18, wallH, 1, { mat: 'brick' });
  b.block(fx, floor, fz + 8.5, 18, wallH, 1, { mat: 'brick' });
  b.block(fx - 8.5, floor, fz, 1, wallH, 18, { mat: 'brick' });
  b.block(fx + 8.5, floor, fz - 5.5, 1, wallH, 7, { mat: 'brick' });
  b.block(fx + 8.5, floor, fz + 5.5, 1, wallH, 7, { mat: 'brick' });
  for (let i = -4; i <= 4; i++) {
    b.block(fx + i * 2, floor + wallH, fz - 8.5, 0.9, 0.7, 1, { mat: 'brick', collider: false });
    b.block(fx + i * 2, floor + wallH, fz + 8.5, 0.9, 0.7, 1, { mat: 'brick', collider: false });
    b.block(fx - 8.5, floor + wallH, fz + i * 2, 1, 0.7, 0.9, { mat: 'brick', collider: false });
  }
  ctx.coins.add(fx - 8, floor + wallH + 1, fz - 8, 'red');
  b.pad(fx + 5, floor, fz + 5.5);
  ctx.addEnemy(new Walker(ctx, V(fx + 3, floor + 0.2, fz - 3), { speed: 1.2 }));
  ctx.addEnemy(new Walker(ctx, V(fx - 4, floor + 0.2, fz + 2), { speed: 1.2 }));

  // Keep with spiral slabs to the top star.
  const kx = fx - 2.5;
  const kz = fz - 2;
  b.block(kx, floor, kz, 5, 10, 5, { mat: 'stone' });
  for (let i = 0; i < 9; i++) {
    const a = i * 0.785;
    const top = floor + 1.1 * (i + 1);
    b.block(kx + Math.cos(a) * 3.9, top - 0.45, kz + Math.sin(a) * 3.9, 1.6, 0.45, 1.6, { mat: 'wood' });
    if (i % 2 === 0) ctx.coins.add(kx + Math.cos(a) * 3.9, top + 0.9, kz + Math.sin(a) * 3.9);
  }
  ctx.addStar('fort-cima', V(kx, floor + 11.3, kz));
  ctx.coins.add(kx + 5.5, floor + 1, kz - 4, 'red');

  // Wall-kick shaft: two tall parallel walls; the star floats at the top.
  const shx = fx - 5.5;
  const shz = fz + 4;
  const shaftH = 12;
  b.block(shx, floor, shz - 1.9, 4, shaftH, 1, { mat: 'metal' });
  b.block(shx, floor, shz + 1.9, 4, shaftH, 1, { mat: 'metal' });
  ctx.addStar('fort-pozo', V(shx, floor + shaftH + 0.8, shz));
  ctx.coins.line(V(shx, floor + 2, shz), V(shx, floor + shaftH - 1, shz), 5);
}
