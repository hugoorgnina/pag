import * as THREE from 'three';
import { createOrbMaterial } from '../render/shaders/orb.js';
import { PLAYER } from './player.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** All collectibles in a single instanced draw call; pickup is a cheap sphere check. */
export class Orbs {
  constructor(spots) {
    this.spots = spots.map((p) => p.clone());
    this.collected = new Array(spots.length).fill(false);
    this.count = 0;
    this.total = spots.length;
    this.pickupRadius = 0.9;

    const geometry = new THREE.IcosahedronGeometry(0.42, 2);
    const phases = new Float32Array(spots.length);
    for (let i = 0; i < spots.length; i++) phases[i] = i * 1.7;
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

    this.material = createOrbMaterial();
    this.mesh = new THREE.InstancedMesh(geometry, this.material, spots.length);
    this.mesh.name = 'orbs';
    this.mesh.frustumCulled = false;
    this._scales = new Array(spots.length).fill(1);
    this._write(0);

    // One real light that hops to the nearest remaining orb (lights are costly).
    this.light = new THREE.PointLight(0xffb13b, 8, 9, 1.5);
  }

  reset() {
    this.collected.fill(false);
    this._scales.fill(1);
    this.count = 0;
  }

  _write(time) {
    for (let i = 0; i < this.spots.length; i++) {
      const s = this._scales[i];
      _p.copy(this.spots[i]);
      _p.y += Math.sin(time * 2 + i) * 0.18;
      _q.setFromEuler(new THREE.Euler(0, time * 1.2 + i, 0.3));
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s.set(s, s, s)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Returns indices collected this step. */
  check(player) {
    const got = [];
    const c = player.center;
    const r = this.pickupRadius + PLAYER.radius;
    for (let i = 0; i < this.spots.length; i++) {
      if (this.collected[i]) continue;
      const o = this.spots[i];
      const dy = Math.max(0, Math.abs(o.y - c.y) - PLAYER.height / 2 + PLAYER.radius);
      if ((o.x - c.x) ** 2 + (o.z - c.z) ** 2 + dy * dy < r * r) {
        this.collected[i] = true;
        this.count++;
        got.push(i);
      }
    }
    return got;
  }

  update(dt, time, playerPos) {
    this.material.uniforms.uTime.value = time;
    let nearest = -1;
    let best = Infinity;
    for (let i = 0; i < this.spots.length; i++) {
      if (this.collected[i]) this._scales[i] = Math.max(0, this._scales[i] - dt * 6);
      else {
        const d = this.spots[i].distanceToSquared(playerPos);
        if (d < best) {
          best = d;
          nearest = i;
        }
      }
    }
    this._write(time);
    this.light.visible = nearest >= 0;
    if (nearest >= 0) this.light.position.copy(this.spots[nearest]);
    return nearest;
  }
}

/** Minimal additive particle bursts on pickup / hits. */
export class Particles {
  constructor(max = 300) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.velocities = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.cursor = 0;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.35,
        map: Particles.dotTexture(),
        color: 0xffd27a,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.points.name = 'particles';
    for (let i = 0; i < max; i++) this.positions[i * 3 + 1] = -9999;
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

  burst(origin, count = 40, speed = 6) {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.positions.set([origin.x, origin.y, origin.z], i * 3);
      this.velocities.set([Math.cos(a) * r * s, Math.abs(u) * s + 2, Math.sin(a) * r * s], i * 3);
      this.life[i] = 0.6 + Math.random() * 0.5;
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
      this.velocities[i * 3 + 1] -= 9 * dt;
      for (let k = 0; k < 3; k++) this.positions[i * 3 + k] += this.velocities[i * 3 + k] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
