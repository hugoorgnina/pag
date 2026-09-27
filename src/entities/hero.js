import * as THREE from 'three';
import { angleDelta, clamp } from '../core/math.js';
import { Layers } from '../physics/physics.js';
import { createToonMaterial } from '../render/shaders/toon.js';

/**
 * Tuning for the classic 3D-platformer moveset. Distances are metres,
 * speeds m/s. Jump heights: single ≈1.7 m, double ≈2.5 m, triple ≈4 m.
 */
export const HERO = Object.freeze({
  radius: 0.38,
  height: 1.45,
  runSpeed: 8.5,
  accel: 24,
  decel: 36,
  turnRate: 11,
  gravity: 34,
  maxFall: 34,
  jumps: [10.6, 12.9, 16.4],
  jumpSpeedBonus: 0.15,
  chainWindow: 0.24,
  tripleMinSpeed: 5.2,
  backflipV: 16.6,
  backflipSpeed: -3.4,
  sideflipV: 15.6,
  sideflipSpeed: 3.6,
  longJumpV: 10.5,
  longJumpMul: 1.6,
  longJumpMax: 15,
  wallKickV: 14,
  wallKickSpeed: 6.5,
  wallWindow: 0.22,
  gpSpinTime: 0.3,
  gpV: -36,
  diveBoost: 3.5,
  diveMax: 14,
  airAccel: 10,
  airTurn: 2.6,
  bounceV: 22,
  fallDamageHeight: 13,
  maxHealth: 8,
});

const AIR = new Set(['jump1', 'jump2', 'jump3', 'backflip', 'sideflip', 'longjump', 'wallkick', 'fall', 'dive', 'kick', 'gpSpin', 'gp', 'bounce', 'hurt', 'burn']);
const CAN_POUND = new Set(['jump1', 'jump2', 'jump3', 'backflip', 'sideflip', 'wallkick', 'fall', 'kick', 'bounce']);
const CAN_WALLKICK = new Set(['jump1', 'jump2', 'jump3', 'fall', 'longjump', 'sideflip', 'backflip', 'wallkick', 'bounce']);
const CAN_AIR_ATTACK = new Set(['jump1', 'jump2', 'jump3', 'fall', 'sideflip', 'backflip', 'wallkick', 'bounce']);

const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _probe = new THREE.Vector3();

/**
 * "Pip", the player character. A state machine in the spirit of classic 3D
 * platformers: horizontal motion is a forward speed along a facing angle, so
 * momentum carries into long jumps, dives and wall kicks.
 */
export class Hero {
  constructor() {
    this.position = new THREE.Vector3();
    this.vy = 0;
    this.speed = 0;
    this.facing = 0;
    this.state = 'move';
    this.stateTime = 0;
    this.grounded = true;
    this.health = HERO.maxHealth;
    this.invulnerable = 0;
    this.lastJump = 0;
    this.sinceLand = 1;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.wallTimer = 0;
    this.wallNormal = new THREE.Vector3();
    this.usedAirAttack = false;
    this.punchStage = 0;
    this.punchQueued = false;
    this.peakY = 0;
    this.skidAngle = 0;
    this.airMax = HERO.runSpeed;
    this.groundCollider = null;
    this.lastSafe = new THREE.Vector3();
    this.events = [];
    this._contact = { normal: new THREE.Vector3() };
    this._anim = { phase: 0, squash: 0 };
    this.object = this._buildModel();
  }

  // ---------------------------------------------------------------- model

  _buildModel() {
    const root = new THREE.Group();
    root.name = 'hero';
    const pivot = new THREE.Group();
    pivot.position.y = 0.72;
    root.add(pivot);
    const body = new THREE.Group();
    body.position.y = -0.72;
    pivot.add(body);
    this.parts = { root, pivot, body };

    this.skin = createToonMaterial({ color: 0x3aa7ff, rim: 0xbfe8ff, shadowTint: 0x3b4fa0 });
    const white = createToonMaterial({ color: 0xffffff, rim: 0xffffff, shadowTint: 0x9aa6d0 });
    const scarfMat = createToonMaterial({ color: 0xff5d73, rim: 0xffd0d6, shadowTint: 0x8a2d50 });
    const shoeMat = createToonMaterial({ color: 0xffb627, rim: 0xfff0c0, shadowTint: 0xa0561a });
    const dark = new THREE.MeshBasicMaterial({ color: 0x1b1d2a });
    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    const torso = mesh(new THREE.SphereGeometry(0.34, 20, 14), this.skin, body, 0, 0.62, 0);
    torso.scale.set(1, 1.05, 0.92);
    mesh(new THREE.SphereGeometry(0.22, 14, 10), white, body, 0, 0.58, 0.15).scale.set(1, 1.1, 0.6);
    const head = new THREE.Group();
    head.position.y = 1.08;
    body.add(head);
    this.parts.head = head;
    mesh(new THREE.SphereGeometry(0.37, 22, 16), this.skin, head);
    for (const x of [-0.13, 0.13]) {
      mesh(new THREE.SphereGeometry(0.1, 12, 10), white, head, x, 0.04, 0.3).scale.set(0.9, 1.25, 0.6);
      mesh(new THREE.SphereGeometry(0.055, 10, 8), dark, head, x * 1.05, 0.03, 0.36).scale.set(1, 1.3, 0.6);
    }
    const scarf = mesh(new THREE.TorusGeometry(0.3, 0.08, 8, 20), scarfMat, body, 0, 0.84, 0);
    scarf.rotation.x = Math.PI / 2;
    const tail = mesh(new THREE.BoxGeometry(0.14, 0.34, 0.06), scarfMat, body, 0.12, 0.72, -0.3);
    tail.rotation.set(0.5, 0, 0.3);
    this.parts.scarfTail = tail;
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), dark, head, 0, 0.47, 0);
    const tip = mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd35c }), head, 0, 0.64, 0);
    this.parts.tip = tip;

    const limb = (x, y, len, mat, endGeo, endMat) => {
      const g = new THREE.Group();
      g.position.set(x, y, 0);
      body.add(g);
      mesh(new THREE.CapsuleGeometry(0.075, len, 4, 8), mat, g, 0, -len / 2 - 0.05, 0);
      const end = mesh(endGeo, endMat, g, 0, -len - 0.12, 0.03);
      return { g, end };
    };
    const hand = new THREE.SphereGeometry(0.11, 12, 10);
    this.parts.armL = limb(-0.36, 0.78, 0.2, this.skin, hand, white);
    this.parts.armR = limb(0.36, 0.78, 0.2, this.skin, hand, white);
    const shoe = new THREE.SphereGeometry(0.13, 12, 10);
    this.parts.legL = limb(-0.15, 0.36, 0.12, this.skin, shoe, shoeMat);
    this.parts.legR = limb(0.15, 0.36, 0.12, this.skin, shoe, shoeMat);
    this.parts.legL.end.scale.set(1, 0.75, 1.4);
    this.parts.legR.end.scale.set(1, 0.75, 1.4);
    return root;
  }

  // ---------------------------------------------------------------- api

  spawn(pos, facing = Math.PI) {
    this.position.copy(pos);
    this.lastSafe.copy(pos);
    this.vy = 0;
    this.speed = 0;
    this.facing = facing;
    this.setState('move');
    this.grounded = true;
    this.groundCollider = null;
    this.invulnerable = 0;
    this.peakY = pos.y;
    this.object.position.copy(pos);
    this.object.rotation.y = facing;
    this.parts.pivot.rotation.set(0, 0, 0);
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  get center() {
    return new THREE.Vector3(this.position.x, this.position.y + HERO.height / 2, this.position.z);
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  get velocity() {
    return new THREE.Vector3(Math.sin(this.facing) * this.speed, this.vy, Math.cos(this.facing) * this.speed);
  }

  get inAir() {
    return AIR.has(this.state);
  }

  get busy() {
    return this.state === 'star' || this.state === 'dead';
  }

  heal(n) {
    this.health = Math.min(HERO.maxHealth, this.health + n);
  }

  /** Damage with knockback away from `from`. Returns true if it landed. */
  hurt(amount, from, { burn = false } = {}) {
    if (this.invulnerable > 0 || this.busy) return false;
    this.health = Math.max(0, this.health - amount);
    this.invulnerable = 2;
    if (from) this.facing = Math.atan2(from.x - this.position.x, from.z - this.position.z);
    this.speed = burn ? 2 : -7;
    this.vy = burn ? 17 : 9;
    this.grounded = false;
    this.setState(burn ? 'burn' : 'hurt');
    this.events.push(burn ? 'burn' : 'hurt');
    if (this.health <= 0) this.events.push('dead');
    return true;
  }

  isStomping(topY) {
    return this.vy < 0 && this.position.y > topY - 0.45 && this.state !== 'hurt' && this.state !== 'burn';
  }

  get pounding() {
    return this.state === 'gp';
  }

  /** Bounce after stomping an enemy (higher if jump is held). */
  bounceOff(held, high = false) {
    if (this.state === 'gp') return;
    this.vy = high ? 16 : held ? 14 : 10.5;
    this.setState('jump1');
    this.usedAirAttack = false;
    this.grounded = false;
  }

  /** Current attack hitbox or null: punches, kicks, dives and the ground-pound shockwave. */
  attackSphere() {
    const f = this.forward;
    const p = this.position;
    switch (this.state) {
      case 'punch':
        if (this.stateTime > 0.04 && this.stateTime < 0.2) return { center: p.clone().addScaledVector(f, 0.75).setY(p.y + 0.8), radius: 0.75 };
        return null;
      case 'kick':
        return this.stateTime < 0.3 ? { center: p.clone().addScaledVector(f, 0.4).setY(p.y + 0.6), radius: 0.95 } : null;
      case 'dive':
        return { center: p.clone().addScaledVector(f, 0.6).setY(p.y + 0.5), radius: 0.7 };
      case 'diveSlide':
        return this.speed > 4 ? { center: p.clone().addScaledVector(f, 0.6).setY(p.y + 0.3), radius: 0.7 } : null;
      case 'gpLand':
        return this.stateTime < 0.12 ? { center: p.clone().setY(p.y + 0.4), radius: 2.3 } : null;
      default:
        return null;
    }
  }

  collectStar() {
    this.setState('star');
    this.speed = 0;
    this.invulnerable = 0;
  }

  // ---------------------------------------------------------------- simulation

  step(dt, input, rig, ctx) {
    const physics = ctx.physics;
    this._input = input;
    this.stateTime += dt;
    this.sinceLand += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.wallTimer -= dt;
    this.coyote -= dt;
    this.jumpBuffer = input.jump ? 0.12 : this.jumpBuffer - dt;

    // Ride moving platforms.
    if (this.grounded && this.groundCollider?.delta) this.position.add(this.groundCollider.delta);

    rig.basis(_f, _r);
    _wish.set(0, 0, 0).addScaledVector(_f, input.move.y).addScaledVector(_r, input.move.x);
    const mag = Math.min(1, _wish.length());
    const inputAngle = mag > 0.05 ? Math.atan2(_wish.x, _wish.z) : this.facing;
    const intent = { input, mag, inputAngle };

    if (this.inAir) this._air(dt, intent);
    else this._ground(dt, intent);

    // Gravity (variable jump height: releasing jump early cuts the rise).
    if (this.state !== 'gpSpin' && this.state !== 'gp' && !(this.state === 'dead' && this.grounded)) {
      let g = HERO.gravity;
      if ((this.state === 'jump1' || this.state === 'jump2') && !input.jumpHeld && this.vy > 3) g *= 2.2;
      this.vy = Math.max(this.vy - g * dt, -HERO.maxFall);
    }
    if (this.state === 'gp') this.vy = HERO.gpV;

    const wasGrounded = this.grounded;
    const wasAir = this.inAir;
    this.position.x += Math.sin(this.facing) * this.speed * dt;
    this.position.z += Math.cos(this.facing) * this.speed * dt;
    this.position.y += this.vy * dt;

    const c = physics.resolveCapsule(this.position, HERO.radius, HERO.height, Layers.STATIC | Layers.TREE, this._contact);

    // Ground snap: stay glued when running down slopes or off tiny ledges.
    if (!c.grounded && wasGrounded && !wasAir && this.vy <= 0) {
      _probe.set(this.position.x, this.position.y + 0.05, this.position.z);
      const hit = physics.raycast(_probe, _down, 0.45, Layers.STATIC | Layers.TREE);
      if (hit) {
        this.position.y = hit.point.y;
        c.grounded = true;
        c.groundCollider = hit.collider;
      }
    }

    if (c.hitCeiling && this.vy > 0) this.vy = 0;

    // Walls: remember contact for wall kicks; stop forward motion into the wall.
    if (c.wall && this.inAir) {
      const dir = Math.sign(this.speed) || 1;
      const mx = Math.sin(this.facing) * dir;
      const mz = Math.cos(this.facing) * dir;
      if (mx * c.wallNormal.x + mz * c.wallNormal.z < -0.35 && Math.abs(this.speed) > 1.5) {
        if (CAN_WALLKICK.has(this.state)) {
          this.wallTimer = HERO.wallWindow;
          this.wallNormal.copy(c.wallNormal);
        }
        if (this.state === 'longjump' || this.state === 'dive') {
          this.speed = -2.5; // bonk
          this.setState('fall');
          this.events.push('bonk');
        } else {
          this.speed = 0;
        }
      }
    }

    this.grounded = c.grounded;
    this.groundCollider = c.groundCollider;

    if (this.inAir) {
      this.peakY = Math.max(this.peakY, this.position.y);
      if (c.grounded && this.vy <= 0) this._land(c, ctx);
    } else if (!c.grounded && !this.busy) {
      // Walked off a ledge.
      this.setState('fall');
      this.coyote = 0.1;
      this.lastJump = 0;
      this.peakY = this.position.y;
    } else if (c.grounded) {
      this.vy = 0;
      this.peakY = this.position.y;
      if (c.kinds.has('bounce') && !this.busy) this._bounce(input);
    }

    this._hazards(ctx);
  }

  _ground(dt, { input, mag, inputAngle }) {
    const s = this.state;
    if (s === 'dead') {
      this.speed = 0;
      return;
    }
    if (s === 'star') {
      this.speed = approach(this.speed, 0, 30 * dt);
      return;
    }

    if (s === 'move' || s === 'land') {
      if (s === 'land' && this.stateTime > 0.12) this.setState('move');
      if (this.jumpBuffer > 0 && s === 'move') return this._jump();
      if (input.attack) {
        if (this.speed > 6) return this._dive(true);
        return this._punch(1);
      }
      if (input.crouch) {
        this.setState(this.speed > 5 ? 'slide' : 'crouch');
        return;
      }
      if (this.speed < 0) this.speed = approach(this.speed, 0, HERO.decel * dt);
      if (mag > 0.1) {
        const d = angleDelta(this.facing, inputAngle);
        if (this.speed > 5.5 && Math.abs(d) > 2.3) {
          this.skidAngle = inputAngle;
          this.setState('skid');
          this.events.push('skid');
          return;
        }
        const rate = HERO.turnRate * (this.speed < 3 ? 2.2 : 1) * dt;
        this.facing += clamp(d, -rate, rate);
        const target = mag * HERO.runSpeed * (1 - Math.min(0.35, Math.abs(d) * 0.2));
        this.speed = approach(this.speed, target, (this.speed < target ? HERO.accel : HERO.decel) * dt);
      } else {
        this.speed = approach(this.speed, 0, HERO.decel * dt);
      }
      return;
    }

    if (s === 'skid') {
      this.speed = approach(this.speed, 0, 34 * dt);
      if (input.jump) {
        this.facing = this.skidAngle;
        this.speed = HERO.sideflipSpeed;
        return this._takeoff('sideflip', HERO.sideflipV);
      }
      if (this.speed <= 0.01) {
        this.facing = this.skidAngle;
        this.setState('move');
      }
      return;
    }

    if (s === 'crouch') {
      this.speed = approach(this.speed, 0, 40 * dt);
      if (input.jump) {
        this.speed = HERO.backflipSpeed;
        return this._takeoff('backflip', HERO.backflipV);
      }
      if (!input.crouch) this.setState('move');
      return;
    }

    if (s === 'slide') {
      this.speed = approach(this.speed, 0, 9 * dt);
      if (mag > 0.1) {
        const d = angleDelta(this.facing, inputAngle);
        this.facing += clamp(d, -1.5 * dt, 1.5 * dt);
      }
      if (input.jump) {
        this.speed = Math.min(Math.max(this.speed, 4) * HERO.longJumpMul, HERO.longJumpMax);
        this.airMax = this.speed;
        this.events.push('longjump');
        return this._takeoff('longjump', HERO.longJumpV);
      }
      if (!input.crouch || this.speed < 1) this.setState(input.crouch ? 'crouch' : 'move');
      return;
    }

    if (s === 'punch') {
      this.speed = approach(this.speed, this.punchStage === 3 ? 2 : 0, 30 * dt);
      if (input.attack && this.stateTime > 0.08) this.punchQueued = true;
      const len = this.punchStage === 3 ? 0.38 : 0.26;
      if (this.stateTime >= len) {
        if (this.punchQueued && this.punchStage < 3) this._punch(this.punchStage + 1);
        else this.setState('move');
      }
      return;
    }

    if (s === 'gpLand') {
      this.speed = 0;
      if (this.stateTime > 0.32) this.setState('move');
      return;
    }

    if (s === 'hardLand') {
      this.speed = 0;
      if (this.stateTime > 0.7) this.setState('move');
      return;
    }

    if (s === 'diveSlide') {
      this.speed = approach(this.speed, 0, 9 * dt);
      if ((input.jump || input.attack) && this.stateTime > 0.1) {
        this.speed = Math.min(this.speed, 6);
        this.lastJump = 0;
        return this._takeoff('jump1', 9.5);
      }
      if (this.speed < 0.6) this.setState('move');
      return;
    }

    this.setState('move');
  }

  _air(dt, { input, mag, inputAngle }) {
    const s = this.state;

    if (s === 'gpSpin') {
      this.speed = 0;
      this.vy = 0;
      if (this.stateTime >= HERO.gpSpinTime) {
        this.setState('gp');
        this.events.push('pound-start');
      }
      return;
    }
    if (s === 'gp' || s === 'star' || s === 'dead') return;

    // Coyote jump just after walking off a ledge.
    if (s === 'fall' && this.coyote > 0 && input.jump) {
      this.lastJump = 0;
      return this._jump();
    }

    if (input.jump && this.wallTimer > 0 && CAN_WALLKICK.has(s)) {
      this.facing = Math.atan2(this.wallNormal.x, this.wallNormal.z);
      this.speed = HERO.wallKickSpeed;
      this.wallTimer = 0;
      this.events.push('wallkick');
      return this._takeoff('wallkick', HERO.wallKickV);
    }

    if (input.crouchPressed && CAN_POUND.has(s)) {
      this.setState('gpSpin');
      this.events.push('spin');
      return;
    }

    if (input.attack && CAN_AIR_ATTACK.has(s) && !this.usedAirAttack) {
      this.usedAirAttack = true;
      if (this.speed > 5) return this._dive(false);
      this.vy = Math.max(this.vy, 4);
      this.setState('kick');
      this.events.push('kick');
      return;
    }

    if (s === 'kick' && this.stateTime > 0.4) this.setState('fall');

    // Air steering: limited turning, speed nudged by stick direction.
    const locked = s === 'hurt' || s === 'burn' || (s === 'wallkick' && this.stateTime < 0.12);
    if (!locked) {
      const turn = s === 'longjump' || s === 'dive' ? 0.9 : s === 'backflip' ? 0.4 : HERO.airTurn;
      const accel = s === 'longjump' || s === 'dive' ? 3 : HERO.airAccel;
      if (mag > 0.1) {
        const d = angleDelta(this.facing, inputAngle);
        this.facing += clamp(d, -turn * dt, turn * dt);
        this.speed += Math.cos(d) * mag * accel * dt;
      } else if (this.speed > 0) {
        this.speed = approach(this.speed, 0, 2 * dt);
      }
      const max = Math.max(HERO.runSpeed, this.airMax);
      this.speed = clamp(this.speed, s === 'backflip' ? HERO.backflipSpeed : -3, max);
    }
  }

  _takeoff(state, vy) {
    this.vy = vy;
    this.grounded = false;
    this.groundCollider = null;
    this.usedAirAttack = false;
    this.peakY = this.position.y;
    if (state !== 'longjump') this.airMax = Math.max(HERO.runSpeed, Math.abs(this.speed));
    this.setState(state);
    this.jumpBuffer = 0;
    this.events.push(state === 'jump1' || state === 'jump2' ? 'jump' : state === 'jump3' ? 'jump3' : 'flip');
  }

  /** Single → double → triple, chained by jumping right after landing. */
  _jump() {
    let n = 1;
    if (this.sinceLand < HERO.chainWindow) {
      if (this.lastJump === 1) n = 2;
      else if (this.lastJump === 2 && this.speed > HERO.tripleMinSpeed) n = 3;
    }
    this.lastJump = n;
    const vy = HERO.jumps[n - 1] + Math.max(0, this.speed) * HERO.jumpSpeedBonus;
    this._takeoff(`jump${n}`, vy);
  }

  _dive(fromGround) {
    this.speed = Math.min(this.speed + HERO.diveBoost, HERO.diveMax);
    this.airMax = this.speed;
    this.vy = fromGround ? 5 : Math.max(this.vy, 3);
    this.grounded = false;
    this.setState('dive');
    this.events.push('dive');
  }

  _punch(stage) {
    this.punchStage = stage;
    this.punchQueued = false;
    this.setState('punch');
    this.events.push(stage === 3 ? 'kick' : 'punch');
  }

  _bounce(input) {
    this.vy = HERO.bounceV + (input.jumpHeld ? 3 : 0);
    this.grounded = false;
    this.usedAirAttack = false;
    this.peakY = this.position.y;
    this.airMax = Math.max(HERO.runSpeed, this.speed);
    this.setState('bounce');
    this.events.push('boing');
  }

  _land(c, ctx) {
    const s = this.state;
    const drop = this.peakY - this.position.y;
    this.vy = 0;
    this.sinceLand = 0;
    this.usedAirAttack = false;
    this.peakY = this.position.y;

    if (c.kinds.has('bounce')) return this._bounce(this._input);

    if (s === 'gp') {
      this.setState('gpLand');
      this.events.push('pound');
      return;
    }
    if (s === 'dead') return;
    if (s === 'star') {
      this.speed = 0;
      return;
    }
    const inWater = ctx.waterLevel !== undefined && this.position.y < ctx.waterLevel - 0.2;
    if (drop > HERO.fallDamageHeight && s !== 'bounce' && !inWater) {
      this.speed = 0;
      this.setState('hardLand');
      this.events.push('hardland');
      if (this.invulnerable <= 0) {
        this.health = Math.max(0, this.health - 3);
        this.invulnerable = 1;
        if (this.health <= 0) this.events.push('dead');
      }
      return;
    }
    if (s === 'dive') {
      this.setState('diveSlide');
      this.events.push('land');
      return;
    }
    if (s === 'jump3' || s === 'backflip' || s === 'sideflip') {
      this.lastJump = 0;
      this.setState('land');
    } else if (s === 'hurt' || s === 'burn') {
      this.speed = 0;
      this.setState('land');
    } else {
      if (s !== 'jump1' && s !== 'jump2') this.lastJump = 0;
      this.setState('move');
    }
    if (this.speed < 0) this.speed = 0;
    this.events.push('land');
    // A jump pressed just before touching down chains immediately.
    if (this.jumpBuffer > 0 && this.state === 'move') this._jump();
  }

  _hazards(ctx) {
    const p = this.position;
    if (ctx.lavaY !== undefined && p.y < ctx.lavaY + 0.05 && !this.busy) {
      p.y = ctx.lavaY + 0.05;
      this.invulnerable = 0;
      this.hurt(3, null, { burn: true });
      this.invulnerable = 1.2;
    }
    if (ctx.waterLevel !== undefined && ctx.physics.terrain) {
      const ground = ctx.physics.terrain.heightAt(p.x, p.z);
      if (this.grounded && ground > ctx.waterLevel + 0.3 && this.invulnerable <= 0) this.lastSafe.copy(p);
      if (p.y < ctx.waterLevel - 1.1 && ground < ctx.waterLevel - 1.1 && !this.busy) {
        this.events.push('splash');
        p.copy(this.lastSafe).y += 0.3;
        this.vy = 0;
        this.speed = 0;
        this.setState('move');
        if (this.invulnerable <= 0) {
          this.health = Math.max(0, this.health - 1);
          this.invulnerable = 1;
          if (this.health <= 0) this.events.push('dead');
        }
      }
      if (p.y < ctx.waterLevel - 0.3 && this.grounded) this.speed = Math.min(this.speed, HERO.runSpeed * 0.6);
    }
    if (p.y < ctx.killY && !this.busy) {
      this.events.push('fallout');
    }
  }

  // ---------------------------------------------------------------- animation

  animate(dt, time) {
    const P = this.parts;
    const s = this.state;
    const t = this.stateTime;
    const a = this._anim;
    const run = clamp(this.speed / HERO.runSpeed, 0, 1.6);
    P.root.position.copy(this.position);
    P.root.rotation.y = this.facing;

    // Target pose (radians); every channel eases toward its target.
    const pose = { pitch: 0, roll: 0, armL: 0, armR: 0, armLz: 0.15, armRz: -0.15, legL: 0, legR: 0, sy: 1, bob: 0, head: 0 };
    let snapPitch = null;
    let snapRoll = null;
    const flip = (dur, dir) => dir * Math.PI * 2 * Math.min(1, 1 - (1 - Math.min(t / dur, 1)) ** 2);

    switch (s) {
      case 'move': {
        a.phase += dt * (4 + this.speed * 1.35);
        const sw = Math.sin(a.phase) * Math.min(1, run) * 1.0;
        pose.legL = sw;
        pose.legR = -sw;
        pose.armL = -sw * 0.8;
        pose.armR = sw * 0.8;
        pose.pitch = run * 0.18;
        pose.bob = Math.abs(Math.cos(a.phase)) * 0.07 * Math.min(1, run);
        if (run < 0.05) {
          pose.sy = 1 + Math.sin(time * 3) * 0.02;
          pose.armLz = 0.25;
          pose.armRz = -0.25;
        }
        break;
      }
      case 'land':
      case 'crouch':
        pose.sy = 0.72;
        pose.legL = pose.legR = -0.6;
        pose.armLz = 0.6;
        pose.armRz = -0.6;
        break;
      case 'slide':
        pose.sy = 0.7;
        pose.pitch = 0.3;
        pose.armL = pose.armR = -1.2;
        break;
      case 'skid':
        pose.pitch = -0.45;
        pose.armL = pose.armR = -1.4;
        pose.legL = 0.8;
        pose.legR = 0.5;
        break;
      case 'punch': {
        const k = Math.sin(Math.min(1, t / 0.14) * Math.PI * 0.5);
        if (this.punchStage === 1) pose.armR = -1.6 * k;
        else if (this.punchStage === 2) pose.armL = -1.6 * k;
        else {
          pose.legR = -1.5 * k;
          pose.pitch = -0.2;
        }
        break;
      }
      case 'jump1':
      case 'fall':
        pose.legL = -0.9;
        pose.legR = 0.4;
        pose.armL = -2.4;
        pose.armR = 0.6;
        if (s === 'fall') {
          pose.armLz = 1.1;
          pose.armRz = -1.1;
          pose.armL = pose.armR = -0.3;
        }
        break;
      case 'jump2':
        pose.legL = 0.5;
        pose.legR = -1.0;
        pose.armL = 0.5;
        pose.armR = -2.6;
        break;
      case 'jump3':
      case 'bounce':
        snapPitch = flip(0.7, 1);
        pose.sy = 0.85;
        pose.legL = pose.legR = -1.2;
        pose.armL = pose.armR = -1.2;
        break;
      case 'backflip':
        snapPitch = flip(0.75, -1);
        pose.legL = pose.legR = -1.1;
        pose.armLz = 1.4;
        pose.armRz = -1.4;
        break;
      case 'sideflip':
        snapRoll = flip(0.65, 1);
        pose.armLz = 1.5;
        pose.armRz = -1.5;
        break;
      case 'longjump':
        pose.pitch = 0.95;
        pose.armL = pose.armR = -2.8;
        pose.legL = pose.legR = 0.7;
        break;
      case 'wallkick':
        pose.armLz = 2.2;
        pose.armRz = -2.2;
        pose.legL = -0.6;
        pose.legR = 0.5;
        break;
      case 'dive':
      case 'diveSlide':
        pose.pitch = 1.45;
        pose.armL = pose.armR = -3.0;
        pose.legL = pose.legR = 0.2;
        if (s === 'diveSlide') pose.bob = -0.35;
        break;
      case 'kick':
        pose.legR = -1.7;
        pose.legL = 0.4;
        pose.armLz = 0.9;
        pose.armRz = -0.9;
        pose.pitch = -0.25;
        break;
      case 'gpSpin':
        snapPitch = flip(HERO.gpSpinTime, 1);
        pose.sy = 0.8;
        pose.legL = pose.legR = -1.6;
        pose.armL = pose.armR = -1.6;
        break;
      case 'gp':
        pose.legL = pose.legR = -1.3;
        pose.armLz = 1.0;
        pose.armRz = -1.0;
        pose.sy = 0.85;
        break;
      case 'gpLand':
      case 'hardLand':
        pose.sy = s === 'gpLand' ? 0.6 + Math.min(1, t / 0.2) * 0.4 : 0.65;
        pose.legL = pose.legR = -0.9;
        pose.armLz = 1.2;
        pose.armRz = -1.2;
        break;
      case 'hurt':
      case 'burn':
        pose.pitch = -0.5;
        pose.armLz = 1.6 + Math.sin(time * 30) * 0.4;
        pose.armRz = -1.6 - Math.sin(time * 30) * 0.4;
        pose.legL = 0.6;
        pose.legR = -0.6;
        break;
      case 'star':
        snapRoll = 0;
        P.root.rotation.y = this.facing + Math.min(1, t / 0.8) * Math.PI * 2;
        pose.armL = -2.9 + Math.sin(time * 12) * 0.2;
        pose.armR = t > 0.8 ? -2.9 : 0.4;
        pose.legL = -0.3;
        pose.bob = t > 0.8 ? 0.15 : 0;
        break;
      case 'dead':
        pose.pitch = -Math.min(1, t / 0.5) * 1.5;
        pose.armLz = 2;
        pose.armRz = -2;
        pose.bob = 0.1;
        break;
    }

    const k = 1 - Math.exp(-18 * dt);
    const lerp = (cur, tgt) => cur + (tgt - cur) * k;
    if (snapPitch !== null) P.pivot.rotation.x = snapPitch;
    else P.pivot.rotation.x = lerp(P.pivot.rotation.x % (Math.PI * 2), pose.pitch);
    if (snapRoll !== null) P.pivot.rotation.z = snapRoll;
    else P.pivot.rotation.z = lerp(P.pivot.rotation.z % (Math.PI * 2), pose.roll);
    P.armL.g.rotation.x = lerp(P.armL.g.rotation.x, pose.armL);
    P.armR.g.rotation.x = lerp(P.armR.g.rotation.x, pose.armR);
    P.armL.g.rotation.z = lerp(P.armL.g.rotation.z, pose.armLz);
    P.armR.g.rotation.z = lerp(P.armR.g.rotation.z, pose.armRz);
    P.legL.g.rotation.x = lerp(P.legL.g.rotation.x, pose.legL);
    P.legR.g.rotation.x = lerp(P.legR.g.rotation.x, pose.legR);
    const sy = lerp(P.body.scale.y, pose.sy);
    P.body.scale.set(1 + (1 - sy) * 0.5, sy, 1 + (1 - sy) * 0.5);
    P.body.position.y = -0.72 + lerp(P.body.position.y + 0.72, pose.bob);
    P.scarfTail.rotation.x = 0.5 + Math.min(1.2, Math.abs(this.speed) * 0.1) + Math.sin(time * 14) * 0.08 * run;
    P.tip.position.y = 0.64 + Math.sin(time * 6) * 0.02;

    const blink = this.invulnerable > 0 && s !== 'star' && Math.floor(time * 16) % 2 === 0;
    this.skin.uniforms.uFlash.value = s === 'burn' ? 0.6 : blink ? 0.5 : 0;
    P.root.visible = !(this.invulnerable > 0.4 && s !== 'hurt' && s !== 'burn' && Math.floor(time * 20) % 3 === 0);
  }
}

