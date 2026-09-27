import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math.js';
import { createToonMaterial } from '../render/shaders/toon.js';

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();

export const PLAYER = Object.freeze({
  radius: 0.4,
  height: 1.6,
  walkSpeed: 6,
  sprintSpeed: 9.5,
  groundAccel: 60,
  airAccel: 14,
  gravity: 24,
  jumpSpeed: 8.6,
  coyoteTime: 0.12,
  jumpBuffer: 0.15,
});

/**
 * Capsule character controller: camera-relative movement, acceleration
 * rather than instant velocity, coyote time + jump buffering, ground snap,
 * wading and a respawn when falling into deep water.
 */
export class Player {
  constructor(physics) {
    this.physics = physics;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.facing = 0;
    this.grounded = false;
    this.health = 100;
    this.invulnerable = 0;
    this.lastSafe = new THREE.Vector3();
    this._coyote = 0;
    this._jumpBuffer = 0;
    this._contact = { normal: new THREE.Vector3() };
    this._squash = 0;
    this.events = []; // 'jump' | 'land' | 'splash'
    this.object = this._buildMesh();
  }

  _buildMesh() {
    const root = new THREE.Group();
    root.name = 'player';
    const body = new THREE.Group();
    root.add(body);
    this.body = body;

    this.bodyMaterial = createToonMaterial({ color: 0x3aa7ff, rim: 0xbfe8ff, shadowTint: 0x3b4fa0 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.height - PLAYER.radius * 2, 6, 16), this.bodyMaterial);
    torso.position.y = PLAYER.height / 2;
    torso.castShadow = true;
    body.add(torso);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1b1d2a });
    for (const x of [-0.14, 0.14]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), eyeMat);
      eye.position.set(x, 1.25, 0.35);
      eye.scale.set(1, 1.4, 0.6);
      body.add(eye);
    }

    const scarfMat = createToonMaterial({ color: 0xff5d73, rim: 0xffd0d6, shadowTint: 0x8a2d50 });
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.09, 8, 20), scarfMat);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.98;
    scarf.castShadow = true;
    body.add(scarf);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 5), eyeMat);
    antenna.position.y = 1.75;
    body.add(antenna);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd35c }));
    tip.position.y = 1.95;
    body.add(tip);
    return root;
  }

  spawn(position, facing = Math.PI) {
    this.position.copy(position);
    this.lastSafe.copy(position);
    this.velocity.set(0, 0, 0);
    this.facing = facing;
    this.health = 100;
    this.invulnerable = 0;
    this.object.position.copy(position);
    this.object.rotation.y = facing;
  }

  get center() {
    return new THREE.Vector3(this.position.x, this.position.y + PLAYER.height / 2, this.position.z);
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  hurt(amount, knockback) {
    if (this.invulnerable > 0 || this.health <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.invulnerable = 1.2;
    if (knockback) {
      this.velocity.x = knockback.x;
      this.velocity.z = knockback.z;
      this.velocity.y = Math.max(this.velocity.y, 5);
    }
    return true;
  }

  step(dt, input, rig) {
    const terrain = this.physics.terrain;
    const move = input.move;
    rig.basis(_forward, _right);
    _wish.set(0, 0, 0).addScaledVector(_forward, move.y).addScaledVector(_right, move.x);

    const inWater = this.position.y < terrain.waterLevel - 0.25;
    let speed = input.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if (inWater) speed *= 0.55;
    const accel = this.grounded ? PLAYER.groundAccel : PLAYER.airAccel;

    // Accelerate horizontal velocity toward the wish velocity.
    const tx = _wish.x * speed;
    const tz = _wish.z * speed;
    const dvx = tx - this.velocity.x;
    const dvz = tz - this.velocity.z;
    const dvLen = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    const k = dvLen > maxDv ? maxDv / dvLen : 1;
    this.velocity.x += dvx * k;
    this.velocity.z += dvz * k;

    // Jumping with coyote time and input buffering: forgiving controls.
    this._coyote = this.grounded ? PLAYER.coyoteTime : this._coyote - dt;
    this._jumpBuffer = input.jump ? PLAYER.jumpBuffer : this._jumpBuffer - dt;
    if (this._jumpBuffer > 0 && this._coyote > 0) {
      this.velocity.y = PLAYER.jumpSpeed * (inWater ? 0.7 : 1);
      this._jumpBuffer = 0;
      this._coyote = 0;
      this.grounded = false;
      this.events.push('jump');
    }

    this.velocity.y -= PLAYER.gravity * dt;
    const wasGrounded = this.grounded;

    this.position.addScaledVector(this.velocity, dt);
    const c = this.physics.resolveCapsule(this.position, PLAYER.radius, PLAYER.height, undefined, this._contact);

    // Ground snap keeps us glued to downhill slopes instead of hopping.
    if (!c.grounded && wasGrounded && this.velocity.y <= 0) {
      const h = terrain.heightAt(this.position.x, this.position.z);
      if (this.position.y - h < 0.35) {
        this.position.y = h;
        c.grounded = true;
      }
    }

    if (c.grounded && this.velocity.y <= 0) {
      if (!wasGrounded && this.velocity.y < -6) {
        this._squash = clamp(-this.velocity.y / 20, 0, 0.35);
        this.events.push('land');
      }
      this.velocity.y = 0;
    }
    if (c.hitCeiling && this.velocity.y > 0) this.velocity.y = 0;
    this.grounded = c.grounded;

    const groundH = terrain.heightAt(this.position.x, this.position.z);
    if (this.grounded && groundH > terrain.waterLevel + 0.3 && this.invulnerable <= 0) {
      this.lastSafe.copy(this.position);
    }
    if (this.position.y < terrain.waterLevel - 1.0 && groundH < terrain.waterLevel - 1.0) {
      this.events.push('splash');
      this.position.copy(this.lastSafe);
      this.position.y += 0.5;
      this.velocity.set(0, 0, 0);
      this.health = Math.max(0, this.health - 10);
      this.invulnerable = 1;
    }
    if (!terrain.isInside(this.position.x, this.position.z, 2)) {
      this.position.x = clamp(this.position.x, -terrain.half + 2, terrain.half - 2);
      this.position.z = clamp(this.position.z, -terrain.half + 2, terrain.half - 2);
    }

    this.invulnerable = Math.max(0, this.invulnerable - dt);
  }

  /** Per-frame visuals: facing, bob, lean, squash & stretch, hit flash. */
  animate(dt, time) {
    const speed = this.horizontalSpeed;
    if (speed > 0.5) this.facing = dampAngle(this.facing, Math.atan2(this.velocity.x, this.velocity.z), 14, dt);
    this.object.position.copy(this.position);
    this.object.rotation.y = this.facing;

    const run = clamp(speed / PLAYER.sprintSpeed, 0, 1);
    const bob = this.grounded ? Math.abs(Math.sin(time * (8 + run * 6))) * 0.08 * run : 0;
    this._squash = damp(this._squash, 0, 10, dt);
    const stretch = this.grounded ? -this._squash : clamp(this.velocity.y * 0.02, -0.12, 0.15);
    this.body.position.y = bob;
    this.body.scale.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5);
    this.body.rotation.x = damp(this.body.rotation.x, run * 0.22, 8, dt);

    const blink = this.invulnerable > 0 && Math.floor(time * 16) % 2 === 0;
    this.bodyMaterial.uniforms.uFlash.value = blink ? 0.55 : 0;
  }
}
