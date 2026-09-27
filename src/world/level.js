import * as THREE from 'three';
import { Layers } from '../physics/physics.js';
import { createNoise2D, mulberry32 } from '../core/math.js';
import { createForest } from './trees.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function crateTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#b98a4e';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#7a5530';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 58, 58);
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(6, 6);
  g.lineTo(58, 58);
  g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 12; y < 64; y += 13) g.fillRect(6, y, 52, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function rockGeometry(seed) {
  const noise = createNoise2D(seed);
  const g = new THREE.IcosahedronGeometry(1, 1); // non-indexed → flat faceted look
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    // Displace by a function of position so shared corners move together (no cracks).
    const k = 0.78 + 0.4 * noise(_p.x * 1.7 + _p.z * 3.1 + 10, _p.y * 2.3 - _p.z + 10);
    _p.multiplyScalar(k);
    _p.y *= 0.7;
    pos.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Builds the island's content: ruins in the central plaza, a forest, rocks
 * and crate stacks. Every visual gets a *simple* collider (box or sphere),
 * and repeated props are batched into InstancedMeshes.
 */
export function buildLevel({ scene, terrain, physics, seed = 42 }) {
  const rand = mulberry32(seed);
  const range = (a, b) => a + (b - a) * rand();
  const occupied = []; // [x, z, radius] used for spacing
  const isFree = (x, z, r) => occupied.every(([ox, oz, or]) => (ox - x) ** 2 + (oz - z) ** 2 > (or + r) ** 2);
  const slopeOk = (x, z, minY) => terrain.normalAt(x, z).y > minY;

  const orbSpots = [];
  const stone = []; // unit-box instances: {center, size}
  const lights = [];

  // --- Ruins ---------------------------------------------------------------
  const plazaY = terrain.heightAt(0, 0);
  const addStone = (cx, y0, cz, sx, sy, sz) => {
    const min = new THREE.Vector3(cx - sx / 2, y0, cz - sz / 2);
    const max = new THREE.Vector3(cx + sx / 2, y0 + sy, cz + sz / 2);
    physics.addBox(min, max, { layer: Layers.STATIC });
    stone.push({ center: new THREE.Vector3(cx, y0 + sy / 2, cz), size: new THREE.Vector3(sx, sy, sz) });
    return y0 + sy;
  };

  // Stepped ziggurat; the crown orb is the hardest to reach.
  // Keep the spawn point and its approach to the ruins clear.
  occupied.push([0, 20, 5], [0, 15, 4]);

  let top = plazaY - 0.4;
  for (const [w, h] of [[7.5, 1.0], [5, 0.7], [2.6, 0.7]]) top = addStone(0, top, 0, w, h, w);
  orbSpots.push(new THREE.Vector3(0, top + 1, 0));
  occupied.push([0, 0, 12]);

  // Ring of pillars — some intact, some broken, two toppled.
  const pillarCount = 10;
  for (let i = 0; i < pillarCount; i++) {
    const a = (i / pillarCount) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * 10;
    const z = Math.sin(a) * 10;
    const base = terrain.heightAt(x, z) - 0.2;
    const kind = i % 5;
    if (kind === 2) {
      // Toppled pillar lying tangentially (kept axis-aligned so its AABB is tight).
      const alongX = Math.abs(Math.sin(a)) > 0.7;
      addStone(x, base, z, alongX ? 3.6 : 1, 1, alongX ? 1 : 3.6);
      continue;
    }
    const plinthTop = addStone(x, base, z, 1.5, 0.35, 1.5);
    const height = kind === 4 ? 0.95 : 4.2;
    const pillarTop = addStone(x, plinthTop, z, 1, height, 1);
    if (kind === 4) orbSpots.push(new THREE.Vector3(x, pillarTop + 1, z));
    else addStone(x, pillarTop, z, 1.4, 0.35, 1.4);
  }

  // Braziers: flickering point lights (lamps / torches).
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 6;
    const z = Math.sin(a) * 6;
    const y = addStone(x, terrain.heightAt(x, z) - 0.1, z, 0.7, 0.9, 0.7);
    const light = new THREE.PointLight(0xff9a3c, 12, 14, 1.6);
    light.position.set(x, y + 0.6, z);
    scene.add(light);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flame.position.set(x, y + 0.3, z);
    scene.add(flame);
    lights.push({ light, flame, base: 12, phase: rand() * 10 });
  }

  // --- Crate stacks --------------------------------------------------------
  const crateSize = 1.2;
  const crates = [];
  let stacks = 0;
  for (let tries = 0; tries < 400 && stacks < 7; tries++) {
    const a = rand() * Math.PI * 2;
    const r = range(26, 90);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = terrain.heightAt(x, z);
    if (h < 1 || h > 9 || !slopeOk(x, z, 0.93) || !isFree(x, z, 5)) continue;
    const y0 = Math.max(terrain.heightAt(x - 1.2, z), terrain.heightAt(x + 1.2, z), terrain.heightAt(x, z - 1.2), terrain.heightAt(x, z + 1.2)) - 0.15;
    const layout = [[-0.62, 0, 0], [0.62, 0, 0], [0, 1, 0.1]];
    for (const [dx, level, dz] of layout) crates.push(new THREE.Vector3(x + dx, y0 + level * crateSize, z + dz));
    if (stacks < 3) orbSpots.push(new THREE.Vector3(x, y0 + crateSize * 2 + 1, z + 0.1));
    occupied.push([x, z, 3]);
    stacks++;
  }
  const crateGeo = new THREE.BoxGeometry(crateSize, crateSize, crateSize);
  const crateMesh = new THREE.InstancedMesh(crateGeo, new THREE.MeshLambertMaterial({ map: crateTexture() }), crates.length);
  crates.forEach((c, i) => {
    const center = _p.set(c.x, c.y + crateSize / 2, c.z);
    crateMesh.setMatrixAt(i, _m.compose(center, _q.identity(), _s.set(1, 1, 1)));
    const half = crateSize / 2;
    physics.addBox(
      new THREE.Vector3(center.x - half, c.y, center.z - half),
      new THREE.Vector3(center.x + half, c.y + crateSize, center.z + half),
    );
  });
  crateMesh.castShadow = crateMesh.receiveShadow = true;
  crateMesh.computeBoundingSphere();
  crateMesh.name = 'crates';
  scene.add(crateMesh);

  // --- Stone blocks (ruins) as one batched draw ----------------------------
  const stoneMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xcfc3a8 }),
    stone.length,
  );
  stone.forEach((s, i) => stoneMesh.setMatrixAt(i, _m.compose(s.center, _q.identity(), s.size)));
  stoneMesh.castShadow = stoneMesh.receiveShadow = true;
  stoneMesh.computeBoundingSphere();
  stoneMesh.name = 'ruins';
  scene.add(stoneMesh);

  // --- Rocks: sphere colliders, faceted visuals ----------------------------
  const rockMatrices = [];
  for (let tries = 0; tries < 2000 && rockMatrices.length < 80; tries++) {
    const x = range(-100, 100);
    const z = range(-100, 100);
    const h = terrain.heightAt(x, z);
    const scale = range(0.6, 1.8);
    if (h < -0.4 || !isFree(x, z, scale + 0.5)) continue;
    const center = new THREE.Vector3(x, h + 0.15 * scale, z);
    _q.setFromAxisAngle(_up, rand() * Math.PI * 2);
    rockMatrices.push(new THREE.Matrix4().compose(center, _q, _s.set(scale, scale, scale)));
    physics.addSphere(center, 0.8 * scale);
    occupied.push([x, z, scale]);
  }
  const rockMesh = new THREE.InstancedMesh(
    rockGeometry(seed),
    new THREE.MeshLambertMaterial({ color: 0x8f8a82, flatShading: true }),
    rockMatrices.length,
  );
  rockMatrices.forEach((m, i) => rockMesh.setMatrixAt(i, m));
  rockMesh.castShadow = rockMesh.receiveShadow = true;
  rockMesh.computeBoundingSphere();
  rockMesh.name = 'rocks';
  scene.add(rockMesh);

  // --- Forest: instanced LOD, trunk-only box colliders ---------------------
  const treeMatrices = [];
  for (let tries = 0; tries < 6000 && treeMatrices.length < 420; tries++) {
    const x = range(-110, 110);
    const z = range(-110, 110);
    const h = terrain.heightAt(x, z);
    if (h < 1.3 || h > 12 || Math.hypot(x, z) < 22 || !slopeOk(x, z, 0.82) || !isFree(x, z, 1.4)) continue;
    const scale = range(0.75, 1.35);
    _q.setFromAxisAngle(_up, rand() * Math.PI * 2);
    treeMatrices.push(new THREE.Matrix4().compose(_p.set(x, h - 0.1, z), _q, _s.set(scale, scale * range(0.9, 1.15), scale)));
    const t = 0.3 * scale;
    physics.addBox(new THREE.Vector3(x - t, h - 0.5, z - t), new THREE.Vector3(x + t, h + 4.5 * scale, z + t), { layer: Layers.TREE });
    occupied.push([x, z, 1.2]);
  }
  const forest = createForest(treeMatrices);
  scene.add(forest);

  // --- Remaining orbs scattered across the island --------------------------
  for (let tries = 0; tries < 3000 && orbSpots.length < 12; tries++) {
    const x = range(-95, 95);
    const z = range(-95, 95);
    const h = terrain.heightAt(x, z);
    if (h < 0.8 || !isFree(x, z, 1.5)) continue;
    if (orbSpots.some((o) => Math.hypot(o.x - x, o.z - z) < 22)) continue;
    orbSpots.push(new THREE.Vector3(x, h + 1.1, z));
    occupied.push([x, z, 1.5]);
  }

  // --- Sentinel patrol routes ---------------------------------------------
  const spawn = new THREE.Vector3(0, 0, 20);
  spawn.y = terrain.heightAt(spawn.x, spawn.z);
  const routes = [];
  for (let tries = 0; tries < 2000 && routes.length < 5; tries++) {
    const a = rand() * Math.PI * 2;
    const r = range(28, 85);
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    if (Math.hypot(cx - spawn.x, cz - spawn.z) < 30) continue;
    if (routes.some((rt) => rt.center.distanceTo(_p.set(cx, 0, cz)) < 30)) continue;
    const radius = range(7, 13);
    const points = [];
    for (let k = 0; k < 5; k++) {
      const b = (k / 5) * Math.PI * 2 + rand() * 0.4;
      const px = cx + Math.cos(b) * radius;
      const pz = cz + Math.sin(b) * radius;
      if (terrain.heightAt(px, pz) < 0.6) break;
      points.push(new THREE.Vector3(px, 0, pz));
    }
    if (points.length === 5) routes.push({ center: new THREE.Vector3(cx, 0, cz), points });
  }

  return { orbSpots, routes, spawn, lights, forest };
}

export function updateLevelLights(lights, time) {
  for (const l of lights) {
    const f = Math.sin(time * 11 + l.phase) * 0.5 + Math.sin(time * 23.7 + l.phase * 2) * 0.3;
    l.light.intensity = l.base * (1 + f * 0.18);
    l.flame.scale.set(1, 1 + f * 0.25, 1);
  }
}
