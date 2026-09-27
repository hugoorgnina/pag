import * as THREE from 'three';
import { clamp, damp, dampVector } from '../core/math.js';
import { Layers } from '../physics/physics.js';

const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _lookAhead = new THREE.Vector3();

/**
 * Third-person orbit camera on a "spring arm":
 *  - smooth follow (frame-rate independent damping)
 *  - look-ahead in the direction of travel
 *  - collision avoidance: raycast from the focus point back to the camera,
 *    pull in instantly when blocked, ease back out when clear
 *  - FOV widens with speed; trauma-based shake on hits
 */
export class ThirdPersonCamera {
  constructor(camera, physics) {
    this.camera = camera;
    this.physics = physics;
    this.yaw = Math.PI;
    this.pitch = 0.32;
    this.distance = 7;
    this.minDistance = 3;
    this.maxDistance = 12;
    this.currentDistance = this.distance;
    this.focus = new THREE.Vector3();
    this.lookAhead = new THREE.Vector3();
    this.baseFov = 62;
    this.trauma = 0;
    this.sensitivity = 0.0026;
    this.floorY = -Infinity;
    this._time = 0;
    this._sinceLook = 10;
  }

  applyLook({ x, y, zoom }) {
    if (x || y) this._sinceLook = 0;
    this.yaw -= x * this.sensitivity;
    this.pitch = clamp(this.pitch + y * this.sensitivity, -0.35, 1.25);
    if (zoom) this.distance = clamp(this.distance + zoom * 0.8, this.minDistance, this.maxDistance);
  }

  /** Horizontal forward/right vectors for camera-relative movement. */
  basis(forward, right) {
    forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  snapTo(target) {
    this.focus.copy(target).y += 1.5;
    this.lookAhead.set(0, 0, 0);
    this.currentDistance = this.distance;
    this.update(0, target, new THREE.Vector3(), 0);
  }

  addTrauma(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /**
   * Lakitu-style assist: when the player hasn't touched the camera for a
   * while and is running, drift gently behind the direction of travel.
   */
  follow(dt, facing, speed01) {
    this._sinceLook += dt;
    if (this._sinceLook < 1.5 || speed01 < 0.3) return;
    const behind = facing + Math.PI;
    let d = (behind - this.yaw) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 2.6) return; // running at the camera: leave it be
    this.yaw += d * (1 - Math.exp(-0.9 * speed01 * dt));
  }

  update(dt, target, velocity, speed01) {
    this._time += dt;

    // Look-ahead: bias the focus toward where the player is heading.
    _lookAhead.set(velocity.x, 0, velocity.z).multiplyScalar(0.28);
    if (_lookAhead.length() > 2.5) _lookAhead.setLength(2.5);
    dampVector(this.lookAhead, _lookAhead, 2.5, dt);

    _desired.copy(target).add(this.lookAhead);
    _desired.y += 1.5;
    // Vertical follow is softer than horizontal so jumps don't jolt the view.
    const fy = damp(this.focus.y, _desired.y, 6, dt);
    dampVector(this.focus, _desired, 12, dt);
    this.focus.y = fy;

    const cp = Math.cos(this.pitch);
    _dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // Spring arm collision against level geometry only (layer mask).
    let allowed = this.distance;
    const hit = this.physics.raycast(this.focus, _dir, this.distance + 0.4, Layers.STATIC | Layers.TREE);
    if (hit) allowed = clamp(hit.distance - 0.4, 0.8, this.distance);
    this.currentDistance = allowed < this.currentDistance
      ? damp(this.currentDistance, allowed, 30, dt) // pull in fast: never show the inside of a wall
      : damp(this.currentDistance, allowed, 3.5, dt); // ease out gently

    const cam = this.camera;
    cam.position.copy(this.focus).addScaledVector(_dir, this.currentDistance);
    const t = this.physics.terrain;
    if (t) cam.position.y = Math.max(cam.position.y, t.heightAt(cam.position.x, cam.position.z) + 0.35, t.waterLevel + 0.3);
    cam.position.y = Math.max(cam.position.y, this.floorY + 0.5);

    // Trauma shake (trauma² feels better than linear).
    const shake = this.trauma * this.trauma;
    if (shake > 0) {
      const s = this._time * 40;
      cam.position.x += Math.sin(s * 1.1) * shake * 0.35;
      cam.position.y += Math.sin(s * 1.7 + 1) * shake * 0.35;
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }

    cam.lookAt(this.focus);

    const fov = this.baseFov + speed01 * 14;
    const newFov = damp(cam.fov, fov, 4, dt);
    if (Math.abs(newFov - cam.fov) > 1e-3) {
      cam.fov = newFov;
      cam.updateProjectionMatrix();
    }
  }
}
