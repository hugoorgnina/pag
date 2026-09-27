import * as THREE from 'three';
import { Terrain } from '../world/terrain.js';
import { createForest } from '../world/trees.js';
import { createWater } from '../render/shaders/water.js';
import { createNoise2D, mulberry32 } from '../core/math.js';
import { Layers } from '../physics/physics.js';
import { Flyer, Golem, Walker } from '../entities/enemies.js';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function rockGeometry(seed) {
  const noise = createNoise2D(seed);
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    const k = 0.78 + 0.4 * noise(_p.x * 1.7 + _p.z * 3.1 + 10, _p.y * 2.3 - _p.z + 10);
    _p.multiplyScalar(k);
    _p.y *= 0.7;
    pos.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Colinas Brisa: the open grassland course on a heightfield island.
 * Stars: the summit tower, eight red coins, and the boss in the ruins.
 */
export function buildBrisa(ctx) {
  const { b, scene, physics } = ctx;
  const rand = mulberry32(42);
  const range = (a, c) => a + (c - a) * rand();

  const terrain = new Terrain();
  physics.terrain = terrain;
  ctx.terrain = terrain;
  ctx.waterLevel = 0;
  ctx.killY = -20;
  scene.add(terrain.createMesh());
  const water = createWater({ terrain, heightTexture: terrain.createHeightTexture() });
  scene.add(water);
  ctx.animated.push(water.material);

  const H = (x, z) => terrain.heightAt(x, z);
  const occupied = [];
  const isFree = (x, z, r) => occupied.every(([ox, oz, or]) => (ox - x) ** 2 + (oz - z) ** 2 > (or + r) ** 2);
  const flatEnough = (x, z, minY = 0.9) => terrain.normalAt(x, z).y > minY;
  const landNear = (x, z, { minH = 1.2, maxH = 9, slope = 0.9 } = {}) => {
    for (let r = 0; r < 30; r += 1) {
      for (let a = 0; a < Math.PI * 2; a += 0.5) {
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        const h = H(px, pz);
        if (h > minH && h < maxH && flatEnough(px, pz, slope) && isFree(px, pz, 2)) return new THREE.Vector3(px, h, pz);
      }
    }
    return new THREE.Vector3(x, H(x, z), z);
  };

  ctx.spawn = new THREE.Vector3(0, H(0, 26), 26);
  ctx.spawnFacing = Math.PI;
  occupied.push([0, 26, 4], [0, 0, 16]);

  // --- Ruins arena (boss) -------------------------------------------------
  const plazaY = H(0, 0);
  const pillars = 12;
  const redSpots = [];
  for (let i = 0; i < pillars; i++) {
    const a = (i / pillars) * Math.PI * 2 + 0.13;
    const x = Math.cos(a) * 12.5;
    const z = Math.sin(a) * 12.5;
    if (Math.abs(x) < 3 && z > 0) continue; // entrance facing the spawn
    const base = H(x, z) - 0.3;
    b.block(x, base, z, 1.6, 0.5, 1.6, { mat: 'stone' });
    const broken = i % 4 === 1;
    const top = base + 0.5 + (broken ? 1.0 : 4.4);
    b.block(x, base + 0.5, z, 1.1, top - base - 0.5, 1.1, { mat: 'stone' });
    if (broken) redSpots.push(new THREE.Vector3(x, top + 0.8, z));
    else b.block(x, top, z, 1.5, 0.4, 1.5, { mat: 'stone' });
  }
  const boss = new Golem(ctx, new THREE.Vector3(0, plazaY, 0), {
    arenaRadius: 12,
    onDefeat: () => ctx.revealStar('brisa-rey'),
  });
  ctx.addEnemy(boss);
  ctx.boss = boss;
  ctx.addStar('brisa-rey', new THREE.Vector3(0, plazaY + 1.6, 0), { hidden: true });

  // --- Summit tower on the highest hill -----------------------------------
  let summit = new THREE.Vector3(0, -Infinity, 0);
  for (let x = -90; x <= 90; x += 3) {
    for (let z = -90; z <= 90; z += 3) {
      if (Math.hypot(x, z) < 40) continue;
      const h = H(x, z);
      if (h > summit.y) summit.set(x, h, z);
    }
  }
  const sx = summit.x;
  const sz = summit.z;
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const a = i * 1.05;
    const x = sx + Math.cos(a) * 4.2;
    const z = sz + Math.sin(a) * 4.2;
    const top = summit.y + 1.1 * (i + 1);
    const ground = Math.min(H(x, z), summit.y) - 1;
    b.column(x, ground, z, 1.3, top - ground, { mat: 'stone', top: 'grass', radial: 16 });
    if (i === 3) redSpots.push(new THREE.Vector3(x, top + 0.9, z));
    else ctx.coins.add(x, top + 0.9, z);
  }
  const crown = summit.y + 7.4;
  b.column(sx, summit.y - 2, sz, 1.8, crown - summit.y + 2, { mat: 'brick', top: 'checker', radial: 20 });
  ctx.addStar('brisa-cima', new THREE.Vector3(sx, crown + 1.4, sz));
  occupied.push([sx, sz, 7]);
  // Coin trail from the plaza toward the summit.
  {
    const dir = new THREE.Vector3(sx, 0, sz).normalize();
    for (let d = 20; d < summit.length() - 10; d += 6) {
      const x = dir.x * d;
      const z = dir.z * d;
      if (H(x, z) > 0.5) ctx.coins.add(x, H(x, z) + 0.9, z);
    }
  }

  // --- Crate stacks ---------------------------------------------------------
  let stacks = 0;
  for (let tries = 0; tries < 500 && stacks < 6; tries++) {
    const a = rand() * Math.PI * 2;
    const r = range(24, 85);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = H(x, z);
    if (h < 1 || h > 9 || !flatEnough(x, z, 0.95) || !isFree(x, z, 5)) continue;
    const y0 = Math.max(H(x - 1.2, z), H(x + 1.2, z), H(x, z - 1.2), H(x, z + 1.2)) - 0.15;
    b.block(x - 0.62, y0, z, 1.2, 1.2, 1.2, { mat: 'wood' });
    b.block(x + 0.62, y0, z, 1.2, 1.2, 1.2, { mat: 'wood' });
    b.block(x, y0 + 1.2, z + 0.1, 1.2, 1.2, 1.2, { mat: 'wood' });
    const spot = new THREE.Vector3(x, y0 + 2.4 + 0.9, z + 0.1);
    if (stacks < 3) redSpots.push(spot);
    else ctx.coins.add(spot.x, spot.y, spot.z, 'blue');
    occupied.push([x, z, 3]);
    stacks++;
  }

  // --- Floating garden with a spring pad ----------------------------------
  const garden = landNear(-30, 30);
  b.pad(garden.x, garden.y - 0.05, garden.z);
  const g1 = garden.y + 5;
  b.platform(garden.x + 4, g1 - 1, garden.z - 3, 4, 1, 4);
  b.platform(garden.x + 9, g1 + 0.6, garden.z - 7, 3, 1, 3);
  redSpots.push(new THREE.Vector3(garden.x + 4, g1 + 0.9, garden.z - 3));
  redSpots.push(new THREE.Vector3(garden.x + 9, g1 + 2.5, garden.z - 7));
  occupied.push([garden.x, garden.z, 12]);

  for (const s of redSpots.slice(0, 8)) ctx.coins.add(s.x, s.y, s.z, 'red');
  const redStar = landNear(10, 20);
  ctx.addStar('brisa-rojas', new THREE.Vector3(redStar.x, redStar.y + 1.6, redStar.z), { hidden: true });
  ctx.onRedCoins = () => ctx.revealStar('brisa-rojas');

  // --- Rocks: sphere colliders behind faceted visuals ---------------------
  const rockMatrices = [];
  for (let tries = 0; tries < 2000 && rockMatrices.length < 70; tries++) {
    const x = range(-100, 100);
    const z = range(-100, 100);
    const h = H(x, z);
    const scale = range(0.6, 1.7);
    if (h < -0.4 || !isFree(x, z, scale + 0.6)) continue;
    const center = new THREE.Vector3(x, h + 0.15 * scale, z);
    _q.setFromAxisAngle(_up, rand() * Math.PI * 2);
    rockMatrices.push(new THREE.Matrix4().compose(center, _q, _s.set(scale, scale, scale)));
    physics.addSphere(center, 0.8 * scale);
    occupied.push([x, z, scale]);
  }
  const rocks = new THREE.InstancedMesh(rockGeometry(42), new THREE.MeshLambertMaterial({ color: 0x8f8a82, flatShading: true }), rockMatrices.length);
  rockMatrices.forEach((m, i) => rocks.setMatrixAt(i, m));
  rocks.castShadow = rocks.receiveShadow = true;
  rocks.computeBoundingSphere();
  scene.add(rocks);

  // --- Forest (instanced LOD) ---------------------------------------------
  const trees = [];
  for (let tries = 0; tries < 6000 && trees.length < 380; tries++) {
    const x = range(-110, 110);
    const z = range(-110, 110);
    const h = H(x, z);
    if (h < 1.3 || h > 12 || Math.hypot(x, z) < 20 || !flatEnough(x, z, 0.82) || !isFree(x, z, 1.4)) continue;
    const scale = range(0.75, 1.35);
    _q.setFromAxisAngle(_up, rand() * Math.PI * 2);
    trees.push(new THREE.Matrix4().compose(_p.set(x, h - 0.1, z), _q, _s.set(scale, scale * range(0.9, 1.15), scale)));
    const t = 0.3 * scale;
    physics.addBox(new THREE.Vector3(x - t, h - 0.5, z - t), new THREE.Vector3(x + t, h + 4.5 * scale, z + t), { layer: Layers.TREE });
    occupied.push([x, z, 1.2]);
    if (trees.length % 40 === 0) ctx.coins.ring(x, h + 1, z, 2.2, 6);
  }
  const forest = createForest(trees);
  scene.add(forest);
  ctx.lods.push(forest);

  // --- Enemies --------------------------------------------------------------
  let walkers = 0;
  for (let tries = 0; tries < 600 && walkers < 9; tries++) {
    const x = range(-85, 85);
    const z = range(-85, 85);
    const h = H(x, z);
    if (h < 1.2 || Math.hypot(x, z) < 20 || Math.hypot(x, z - 26) < 16 || !flatEnough(x, z, 0.9)) continue;
    ctx.addEnemy(new Walker(ctx, new THREE.Vector3(x, h + 0.2, z)));
    walkers++;
  }
  for (const [x, z] of [[-40, -30], [45, 10], [10, -60]]) {
    const p = landNear(x, z, { minH: 0.5, maxH: 20, slope: 0 });
    ctx.addEnemy(new Flyer(ctx, new THREE.Vector3(p.x, p.y + 3, p.z), { radius: 6 }));
  }

  // Coins: a path from the spawn to the ruins and a ring inside the arena.
  ctx.coins.line(new THREE.Vector3(0, H(0, 22) + 0.9, 22), new THREE.Vector3(0, plazaY + 0.9, 15), 5);
  ctx.coins.ring(0, plazaY + 0.9, 0, 6, 10);
}
