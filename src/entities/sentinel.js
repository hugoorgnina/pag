import * as THREE from 'three';
import { angleDelta, clamp, damp, dampAngle } from '../core/math.js';
import { Layers } from '../physics/physics.js';
import { createToonMaterial } from '../render/shaders/toon.js';
import { PLAYER } from './player.js';

export const SENTINEL = Object.freeze({
  radius: 0.6,
  hover: 1.7,
  patrolSpeed: 2.6,
  chaseSpeed: 6.4,
  viewRange: 22,
  viewAngle: THREE.MathUtils.degToRad(70), // full cone angle
  loseSightTime: 2.2,
  searchTime: 3.5,
  damage: 20,
});

const EYE_COLORS = {
  patrol: new THREE.Color(0x6cf0ff),
  alert: new THREE.Color(0xffd23c),
  chase: new THREE.Color(0xff3b3b),
  search: new THREE.Color(0xff9a3c),
};

const _toTarget = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _feet = new THREE.Vector3();
const _contact = { normal: new THREE.Vector3() };

/**
 * Hovering sentry drone with a finite-state brain:
 *   patrol → (sees player) → alert → chase → (loses sight) → search → patrol
 * Vision is a cone test followed by a raycast against level geometry, so
 * hiding behind ruins, rocks or trees actually works.
 */
export class Sentinel {
  constructor(physics, route, { spotLight = true } = {}) {
    this.physics = physics;
    this.route = route;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.lastSeen = new THREE.Vector3();
    this.events = [];
    this.object = this._buildMesh(spotLight);
    this.reset();
  }

  reset() {
    this.waypoint = 1;
    const start = this.route.points[0];
    this.position.set(start.x, this.physics.terrain.heightAt(start.x, start.z) + SENTINEL.hover, start.z);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.state = 'patrol';
    this.stateTime = 0;
    this.lostTime = 0;
    this.stun = 0;
    this.events.length = 0;
    this.object.position.copy(this.position);
  }

  _buildMesh(withSpot) {
    const root = new THREE.Group();
    root.name = 'sentinel';
    this.shellMaterial = createToonMaterial({ color: 0x4a4f63, rim: 0x9aa6ff, shadowTint: 0x2a2f55 });
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(SENTINEL.radius, 2), this.shellMaterial);
    shell.castShadow = true;
    root.add(shell);

    this.eyeMaterial = new THREE.MeshBasicMaterial({ color: EYE_COLORS.patrol.clone() });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), this.eyeMaterial);
    eye.position.set(0, 0.08, SENTINEL.radius * 0.82);
    eye.scale.set(1, 1, 0.5);
    root.add(eye);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.06, 6, 28),
      createToonMaterial({ color: 0xc8cde0, rim: 0xffffff }),
    );
    this.ring.rotation.x = Math.PI / 2;
    root.add(this.ring);

    // Spot light doubles as a readable vision cone (disabled on low quality).
    this.spot = new THREE.SpotLight(0x9ff4ff, 30, SENTINEL.viewRange, SENTINEL.viewAngle / 2, 0.45, 1.2);
    this.spot.position.set(0, 0.1, 0.5);
    this.spot.target.position.set(0, -1.6, 6);
    root.add(this.spot, this.spot.target);
    this.spot.visible = withSpot;
    return root;
  }

  setSpotLight(enabled) {
    this.spot.visible = enabled;
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  canSee(player, fullCircle = false) {
    _eye.copy(this.position);
    const target = player.center;
    _toTarget.subVectors(target, _eye);
    const dist = _toTarget.length();
    const range = fullCircle ? SENTINEL.viewRange * 1.2 : SENTINEL.viewRange;
    if (dist > range) return false;
    if (!fullCircle) {
      const angle = Math.abs(angleDelta(this.yaw, Math.atan2(_toTarget.x, _toTarget.z)));
      if (angle > SENTINEL.viewAngle / 2) return false;
    }
    return this.physics.lineOfSight(_eye, target, Layers.STATIC | Layers.TREE);
  }

  _setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.stateTime = 0;
    this.events.push(state);
  }

  _moveTowards(target, speed, dt) {
    _toTarget.set(target.x - this.position.x, 0, target.z - this.position.z);
    const dist = _toTarget.length();
    if (dist > 0.05) {
      _toTarget.divideScalar(dist);
      this.yaw = dampAngle(this.yaw, Math.atan2(_toTarget.x, _toTarget.z), 6, dt);
    }
    const desired = dist > 0.3 ? speed : 0;
    this.velocity.x = damp(this.velocity.x, _toTarget.x * desired, 5, dt);
    this.velocity.z = damp(this.velocity.z, _toTarget.z * desired, 5, dt);
    return dist;
  }

  step(dt, player, time) {
    this.stateTime += dt;
    this.stun = Math.max(0, this.stun - dt);
    const sees = player.health > 0 && this.canSee(player, this.state === 'chase' || this.state === 'search');

    switch (this.state) {
      case 'patrol': {
        const wp = this.route.points[this.waypoint];
        if (this._moveTowards(wp, SENTINEL.patrolSpeed, dt) < 1) this.waypoint = (this.waypoint + 1) % this.route.points.length;
        if (sees) {
          this.lastSeen.copy(player.position);
          this._setState('alert');
        }
        break;
      }
      case 'alert': {
        // Brief wind-up: gives the player a moment to react.
        this._moveTowards(player.position, 0, dt);
        this.yaw = dampAngle(this.yaw, Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z), 10, dt);
        if (this.stateTime > 0.45) this._setState('chase');
        break;
      }
      case 'chase': {
        if (sees) {
          this.lastSeen.copy(player.position);
          this.lostTime = 0;
        } else {
          this.lostTime += dt;
        }
        this._moveTowards(this.lastSeen, this.stun > 0 ? 0 : SENTINEL.chaseSpeed, dt);
        if (this.lostTime > SENTINEL.loseSightTime) this._setState('search');
        break;
      }
      case 'search': {
        const d = this._moveTowards(this.lastSeen, SENTINEL.patrolSpeed * 1.4, dt);
        if (d < 1.2) this.yaw += dt * 2.2; // look around
        if (sees) this._setState('chase');
        else if (this.stateTime > SENTINEL.searchTime + 2) {
          this.waypoint = this._nearestWaypoint();
          this._setState('patrol');
        }
        break;
      }
    }

    // Integrate, then resolve against the level as a sphere.
    const terrain = this.physics.terrain;
    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
    if (terrain.heightAt(nx, nz) > terrain.waterLevel + 0.4) {
      this.position.x = nx;
      this.position.z = nz;
    } else {
      this.velocity.x = this.velocity.z = 0;
    }
    const hoverY = terrain.heightAt(this.position.x, this.position.z) + SENTINEL.hover + Math.sin(time * 2.3 + this.route.center.x) * 0.15;
    this.position.y = damp(this.position.y, hoverY, 6, dt);
    _feet.copy(this.position).y -= SENTINEL.radius;
    this.physics.resolveCapsule(_feet, SENTINEL.radius, SENTINEL.radius * 2, Layers.STATIC | Layers.TREE, _contact);
    this.position.x = _feet.x;
    this.position.z = _feet.z;
    this.position.y = Math.max(this.position.y, _feet.y + SENTINEL.radius);

    // Contact damage.
    const c = player.center;
    const dy = Math.abs(c.y - this.position.y);
    const dxz = Math.hypot(c.x - this.position.x, c.z - this.position.z);
    if (dxz < SENTINEL.radius + PLAYER.radius + 0.1 && dy < PLAYER.height / 2 + SENTINEL.radius) {
      const kb = new THREE.Vector3(c.x - this.position.x, 0, c.z - this.position.z).normalize().multiplyScalar(11);
      if (player.hurt(SENTINEL.damage, kb)) {
        this.events.push('hit');
        this.stun = 0.9;
        this.velocity.multiplyScalar(-0.5);
      }
    }
  }

  _nearestWaypoint() {
    let best = 0;
    let bestD = Infinity;
    this.route.points.forEach((p, i) => {
      const d = p.distanceToSquared(this.position);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  animate(dt, time) {
    this.object.position.copy(this.position);
    this.object.rotation.y = this.yaw;
    this.ring.rotation.z += dt * (this.state === 'chase' ? 7 : 1.5);
    const tilt = clamp(Math.hypot(this.velocity.x, this.velocity.z) * 0.05, 0, 0.3);
    this.object.rotation.x = damp(this.object.rotation.x, tilt, 5, dt);
    const target = EYE_COLORS[this.state];
    this.eyeMaterial.color.lerp(target, 1 - Math.exp(-10 * dt));
    this.spot.color.copy(this.eyeMaterial.color);
    const blink = this.state === 'alert' && Math.floor(time * 12) % 2 === 0;
    this.shellMaterial.uniforms.uEmissive.value.setRGB(blink ? 0.35 : 0, blink ? 0.25 : 0, 0);
  }
}
