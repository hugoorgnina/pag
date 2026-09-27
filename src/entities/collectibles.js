import * as THREE from 'three';
import { createToonMaterial } from '../render/shaders/toon.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

export const COIN_VALUE = { yellow: 1, red: 2, blue: 5 };

/**
 * Every coin in a course, one InstancedMesh per colour (a single draw call
 * each). Coins placed in the level plus a pool for coins dropped by enemies.
 */
export class Coins {
  constructor(scene, capacity = 400) {
    this.items = [];
    this.capacity = capacity;
    const geo = new THREE.CylinderGeometry(0.36, 0.36, 0.09, 18).rotateX(Math.PI / 2);
    const make = (color, emissive) => {
      const mesh = new THREE.InstancedMesh(
        geo,
        new THREE.MeshLambertMaterial({ color, emissive }),
        capacity,
      );
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.count = 0;
      scene.add(mesh);
      return mesh;
    };
    this.meshes = {
      yellow: make(0xffd23a, 0x8a5200),
      red: make(0xff3a3a, 0x7a0000),
      blue: make(0x4a94ff, 0x0a2a80),
    };
    this.redTotal = 0;
  }

  add(x, y, z, type = 'yellow') {
    if (this.items.length >= this.capacity) return null;
    const item = { pos: new THREE.Vector3(x, y, z), type, active: true, vel: null, rest: y, phase: this.items.length * 0.37 };
    this.items.push(item);
    if (type === 'red') this.redTotal++;
    return item;
  }

  line(a, b, n, type) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      this.add(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, type);
    }
  }

  ring(cx, cy, cz, r, n, type) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.add(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r, type);
    }
  }

  /** Coin popping out of a defeated enemy. */
  drop(pos, count = 1, type = 'yellow') {
    for (let i = 0; i < count; i++) {
      const item = this.add(pos.x, pos.y + 0.6, pos.z, type);
      if (!item) return;
      const a = Math.random() * Math.PI * 2;
      const s = count > 1 ? 2.5 : 0;
      item.vel = new THREE.Vector3(Math.cos(a) * s, 7, Math.sin(a) * s);
      item.rest = pos.y + 0.7;
    }
  }

  /** Collect coins touching a vertical capsule; returns collected items. */
  collect(center, halfHeight, radius) {
    const got = [];
    const r = radius + 0.45;
    for (const c of this.items) {
      if (!c.active || (c.vel && c.vel.y > 0)) continue;
      const dy = Math.max(0, Math.abs(c.pos.y - center.y) - halfHeight);
      if ((c.pos.x - center.x) ** 2 + (c.pos.z - center.z) ** 2 + dy * dy < r * r) {
        c.active = false;
        got.push(c);
      }
    }
    return got;
  }

  update(dt, time) {
    const counts = { yellow: 0, red: 0, blue: 0 };
    for (const c of this.items) {
      if (!c.active) continue;
      if (c.vel) {
        c.vel.y -= 22 * dt;
        c.pos.addScaledVector(c.vel, dt);
        if (c.vel.y < 0 && c.pos.y <= c.rest) {
          c.pos.y = c.rest;
          c.vel = null;
        }
      }
      _p.copy(c.pos);
      _p.y += Math.sin(time * 2.5 + c.phase) * 0.06;
      _q.setFromEuler(_e.set(0, time * 3.2 + c.phase, 0));
      const mesh = this.meshes[c.type];
      mesh.setMatrixAt(counts[c.type]++, _m.compose(_p, _q, _s.set(1, 1, 1)));
    }
    for (const type of Object.keys(this.meshes)) {
      const mesh = this.meshes[type];
      mesh.count = counts[type];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

let starGeometry = null;
function getStarGeometry() {
  if (starGeometry) return starGeometry;
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.75 : 0.34;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  starGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 2 });
  starGeometry.center();
  return starGeometry;
}

/**
 * Power Star-style goal object. Stars already saved show as a translucent
 * ghost (they can be collected again but don't count twice).
 */
export class Star {
  constructor(scene, { id, name, pos, hidden = false, saved = false }) {
    this.id = id;
    this.name = name;
    this.pos = pos.clone();
    this.hidden = hidden;
    this.saved = saved;
    this.collected = false;
    this.material = saved
      ? new THREE.MeshLambertMaterial({ color: 0x7fb4ff, transparent: true, opacity: 0.55, emissive: 0x1a3d80 })
      : createToonMaterial({ color: 0xffd23c, rim: 0xfff6c0, emissive: 0x3a2400, shadowTint: 0xc07000 });
    this.mesh = new THREE.Mesh(getStarGeometry(), this.material);
    this.mesh.castShadow = true;
    this.mesh.position.copy(this.pos);
    this.mesh.visible = !hidden;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x241a08 });
    for (const x of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 8), eyeMat);
      eye.position.set(x, 0.05, 0.24);
      this.mesh.add(eye);
    }
    this.light = new THREE.PointLight(0xffd76a, 6, 7, 1.6);
    this.light.visible = !hidden;
    this.mesh.add(this.light);
    scene.add(this.mesh);
    this.appear = hidden ? 0 : 1;
  }

  reveal() {
    if (!this.hidden) return false;
    this.hidden = false;
    this.mesh.visible = true;
    this.light.visible = true;
    this.appear = 0;
    return true;
  }

  get available() {
    return !this.hidden && !this.collected;
  }

  update(dt, time) {
    if (this.hidden || this.collected) return;
    this.appear = Math.min(1, this.appear + dt * 1.5);
    const s = this.appear < 1 ? 1 + Math.sin(this.appear * Math.PI) * 0.6 : 1;
    this.mesh.scale.setScalar(this.appear * s);
    this.mesh.rotation.y = time * 2;
    this.mesh.position.y = this.pos.y + Math.sin(time * 2.2) * 0.15;
  }

  touches(center, halfHeight, radius) {
    if (!this.available || this.appear < 0.6) return false;
    const dy = Math.max(0, Math.abs(this.pos.y - center.y) - halfHeight);
    const r = radius + 0.75;
    return (this.pos.x - center.x) ** 2 + (this.pos.z - center.z) ** 2 + dy * dy < r * r;
  }
}

/** Additive particle bursts: coin sparkles, stomps, dust, lava embers. */
export class Particles {
  constructor(scene, max = 500) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.velocities = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.cursor = 0;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.35,
        map: Particles.dotTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    for (let i = 0; i < max; i++) this.positions[i * 3 + 1] = -9999;
    scene.add(this.points);
  }

  static dotTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }

  burst(origin, { count = 30, speed = 6, color = 0xffd27a, up = 2, gravity = 9, life = 0.8 } = {}) {
    const col = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.positions.set([origin.x, origin.y, origin.z], i * 3);
      this.velocities.set([Math.cos(a) * r * s, Math.abs(u) * s + up, Math.sin(a) * r * s], i * 3);
      this.colors.set([col.r, col.g, col.b], i * 3);
      this.life[i] = life * (0.6 + Math.random() * 0.6);
      this.gravity[i] = gravity;
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -9999;
        continue;
      }
      this.velocities[i * 3 + 1] -= this.gravity[i] * dt;
      for (let k = 0; k < 3; k++) this.positions[i * 3 + k] += this.velocities[i * 3 + k] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

