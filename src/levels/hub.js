import * as THREE from 'three';
import { createForest } from '../world/trees.js';
import { cylinderGeometry, surface } from '../world/builder.js';
import { createPortalMaterial, textSprite } from '../render/shaders/effects.js';

const PORTALS = [
  { level: 'brisa', angle: Math.PI * 0.72, colors: [0x6ee06a, 0x2f9fe0] },
  { level: 'fortaleza', angle: Math.PI * 1.02, colors: [0xffffff, 0xb58cff] },
  { level: 'caldera', angle: Math.PI * 0.02, colors: [0xffc23a, 0xff3b1f] },
];

/**
 * Plaza del Cielo: a floating island hub. Portals lead to the courses and
 * unlock with stars; a spiral of floating steps climbs the central tower to
 * a secret star.
 */
export function buildHub(ctx, { levels, starCount }) {
  const { b, scene } = ctx;
  ctx.killY = -30;
  ctx.spawn = new THREE.Vector3(0, 0, 20);
  ctx.spawnFacing = Math.PI;

  // Island: grassy top, earthy rim, rocky cone underneath.
  b.column(0, -4, 0, 26, 4, { mat: 'dirt', top: 'grass', radial: 48 });
  const under = new THREE.Mesh(cylinderGeometry(4, 16, 32, 25.5), surface('stone', 0x9a8f80));
  under.position.y = -12;
  scene.add(under);
  b.column(0, -0.9, 0, 9, 1.0, { mat: 'checker', radial: 40 });

  // Tower of the Sky with crenellations.
  b.column(0, 0.1, 0, 4.5, 15.9, { mat: 'stone', radial: 32 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.block(Math.cos(a) * 4.1, 16, Math.sin(a) * 4.1, 1, 0.8, 1, { mat: 'stone' });
  }
  b.block(0, 16, 0, 1.2, 0.25, 1.2, { mat: 'checkerBlue' });
  // Spiral steps around the tower.
  const steps = 13;
  for (let i = 0; i < steps; i++) {
    const a = Math.PI / 2 + i * 0.47;
    const y = 1.2 + i * 1.15;
    b.block(Math.cos(a) * 7, y - 0.5, Math.sin(a) * 7, 1.9, 0.5, 1.9, { mat: 'wood' });
    if (i % 3 === 1) ctx.coins.add(Math.cos(a) * 7, y + 0.8, Math.sin(a) * 7);
  }
  ctx.addStar('hub-torre', new THREE.Vector3(0, 17.4, 0));

  // Portals to the courses.
  for (const p of PORTALS) {
    const info = levels[p.level];
    const x = Math.cos(p.angle) * 17;
    const z = Math.sin(p.angle) * 17;
    b.column(x, 0, z, 2.3, 0.35, { mat: 'checkerBlue', radial: 28 });
    const group = new THREE.Group();
    group.position.set(x, 0.35 + 2.1, z);
    group.lookAt(0, group.position.y, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.26, 12, 40), surface('metal', 0xffe08a));
    ring.castShadow = true;
    group.add(ring);
    const mat = createPortalMaterial(...p.colors);
    const locked = starCount < info.required;
    mat.uniforms.uLocked.value = locked ? 1 : 0;
    group.add(new THREE.Mesh(new THREE.CircleGeometry(1.7, 40), mat));
    const sign = textSprite([info.name, locked ? `Necesitas ★ ${info.required}` : `★ ${info.stars.length} estrellas`]);
    sign.position.y = 3.1;
    group.add(sign);
    scene.add(group);
    ctx.portals.push({ level: p.level, pos: new THREE.Vector3(x, 0.35, z), required: info.required, locked, material: mat });
  }

  // Coins around the plaza (they heal; hub coins don't count toward anything).
  ctx.coins.ring(0, 1, 0, 11, 16);

  // A few trees at the rim.
  const matrices = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    if (PORTALS.some((p) => Math.abs(((a - p.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.35)) continue;
    if (Math.abs(a - Math.PI / 2) < 0.3) continue; // keep the spawn clear
    const r = 22 + (i % 3);
    const s = 0.9 + (i % 4) * 0.12;
    matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
    const t = 0.3 * s;
    ctx.physics.addBox(new THREE.Vector3(Math.cos(a) * r - t, 0, Math.sin(a) * r - t), new THREE.Vector3(Math.cos(a) * r + t, 4.5 * s, Math.sin(a) * r + t));
  }
  const forest = createForest(matrices);
  scene.add(forest);
  ctx.lods.push(forest);

  // Distant clouds far below sell the altitude.
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x404a60 });
  for (let i = 0; i < 18; i++) {
    const a = i * 2.4;
    const r = 45 + (i % 5) * 18;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + (i % 3) * 3, 12, 8), cloudMat);
    puff.position.set(Math.cos(a) * r, -28 - (i % 4) * 5, Math.sin(a) * r);
    puff.scale.y = 0.45;
    scene.add(puff);
  }
}
