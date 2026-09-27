import * as THREE from 'three';
import { angleDelta, clamp, damp, dampAngle } from '../core/math.js';
import { Layers } from '../physics/physics.js';
import { createToonMaterial } from '../render/shaders/toon.js';
import { HERO } from './hero.js';

const _v = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const MASK = Layers.STATIC | Layers.TREE;

function toonMesh(geo, opts, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, createToonMaterial(opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function angryEyes(parent, y, z, spread, size = 0.11) {
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const black = new THREE.MeshBasicMaterial({ color: 0x151515 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), white);
    eye.position.set(s * spread, y, z);
    eye.scale.set(0.8, 1.2, 0.5);
    parent.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(size * 0.5, 8, 6), black);
    pupil.position.set(s * spread * 0.9, y - size * 0.1, z + size * 0.45);
    parent.add(pupil);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(size * 2.2, size * 0.45, size * 0.4), black);
    brow.position.set(s * spread, y + size * 1.3, z + size * 0.2);
    brow.rotation.z = s * 0.45;
    parent.add(brow);
  }
}

/** Shared hero contact logic: stomp, attack hitbox, or damage the hero. */
function heroContact(enemy, hero, top, radius, { damage = 1, stompable = true } = {}) {
  const p = hero.position;
  const dx = p.x - enemy.position.x;
  const dz = p.z - enemy.position.z;
  const dxz = Math.hypot(dx, dz);
  const hit = hero.attackSphere();
  if (hit) {
    _v.copy(enemy.position).setY(enemy.position.y + (top - enemy.position.y) / 2);
    if (_v.distanceTo(hit.center) < hit.radius + radius) return 'attacked';
  }
  const overlapY = p.y < top + 0.1 && p.y + HERO.height > enemy.position.y;
  if (dxz > radius + HERO.radius || !overlapY) return null;
  if (stompable && hero.isStomping(top)) return 'stomped';
  if (hero.hurt(damage, enemy.position)) return 'hurt-hero';
  return null;
}

/**
 * Bellotín: a grumpy acorn that wanders near home, charges when it spots the
 * hero, and turns back at ledges. Stomp, punch or ground-pound it for a coin.
 */
export class Walker {
  constructor(ctx, pos, { color = 0xa8662e, cap = 0x6b3d1c, speed = 1 } = {}) {
    this.ctx = ctx;
    this.home = pos.clone();
    this.position = pos.clone();
    this.vy = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.state = 'wander';
    this.stateTime = 0;
    this.target = pos.clone();
    this.speedMul = speed;
    this.radius = 0.5;
    this.height = 0.95;
    this.alive = true;
    this.remove = false;
    this._contact = { normal: new THREE.Vector3() };
    this.object = new THREE.Group();
    const body = new THREE.Group();
    this.object.add(body);
    this.body = body;
    toonMesh(new THREE.SphereGeometry(0.5, 18, 14), { color, rim: 0xffd9a0, shadowTint: 0x5a3010 }, body, 0, 0.5, 0).scale.set(1, 0.95, 1);
    const capMesh = toonMesh(new THREE.SphereGeometry(0.53, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), { color: cap, rim: 0xc89060, shadowTint: 0x301808 }, body, 0, 0.62, 0);
    capMesh.scale.set(1, 0.6, 1);
    toonMesh(new THREE.CylinderGeometry(0.05, 0.07, 0.22, 6), { color: cap }, body, 0, 1.0, 0);
    angryEyes(body, 0.5, 0.42, 0.16);
    this.feet = [-0.2, 0.2].map((x) => {
      const f = toonMesh(new THREE.SphereGeometry(0.16, 10, 8), { color: 0x3a2a1a }, this.object, x, 0.08, 0.05);
      f.scale.set(1, 0.6, 1.4);
      return f;
    });
    ctx.scene.add(this.object);
    this._pickTarget();
  }

  _pickTarget() {
    const a = Math.random() * Math.PI * 2;
    const r = 1.5 + Math.random() * 4;
    this.target.set(this.home.x + Math.cos(a) * r, this.home.y, this.home.z + Math.sin(a) * r);
  }

  _groundAhead(dist) {
    const f = _v.set(Math.sin(this.yaw) * dist, 0, Math.cos(this.yaw) * dist).add(this.position);
    f.y += 0.8;
    const hit = this.ctx.physics.raycast(f.clone(), _down, 3, MASK);
    if (!hit) return false;
    const danger = this.ctx.lavaY ?? (this.ctx.waterLevel !== undefined ? this.ctx.waterLevel - 0.2 : -Infinity);
    return hit.point.y > danger + 0.15;
  }

  defeat(how) {
    if (!this.alive) return;
    this.alive = false;
    this.state = how === 'stomped' ? 'squashed' : 'launched';
    this.stateTime = 0;
    this.launch = new THREE.Vector3(Math.sin(this.ctx.hero.facing) * 8, 9, Math.cos(this.ctx.hero.facing) * 8);
    this.ctx.coins.drop(this.position, 1);
    this.ctx.emit('enemy-defeat', this.position);
  }

  step(dt, hero) {
    this.stateTime += dt;
    if (!this.alive) {
      if (this.state === 'launched') {
        this.launch.y -= 30 * dt;
        this.position.addScaledVector(this.launch, dt);
        this.object.rotation.x += dt * 12;
      }
      if (this.stateTime > 0.7) this.remove = true;
      return;
    }

    const toHero = _v.subVectors(hero.position, this.position);
    const dist = Math.hypot(toHero.x, toHero.z);
    const seesHero = dist < 7 && Math.abs(toHero.y) < 2.5 && !hero.busy;
    let speed = 0;
    let goal = this.target;
    if (this.state === 'wander') {
      speed = 1.4;
      if (Math.hypot(this.target.x - this.position.x, this.target.z - this.position.z) < 0.6 || this.stateTime > 5) {
        this._pickTarget();
        this.stateTime = 0;
      }
      if (seesHero) {
        this.state = 'alert';
        this.stateTime = 0;
        this.vy = 4; // hop of surprise
      }
    } else if (this.state === 'alert') {
      goal = hero.position;
      if (this.stateTime > 0.4) this.state = 'chase';
    } else if (this.state === 'chase') {
      goal = hero.position;
      speed = 3.6;
      if (dist > 11 || Math.abs(toHero.y) > 4) {
        this.state = 'wander';
        this.stateTime = 0;
      }
    }
    speed *= this.speedMul;

    const want = Math.atan2(goal.x - this.position.x, goal.z - this.position.z);
    this.yaw = dampAngle(this.yaw, want, this.state === 'chase' ? 8 : 4, dt);
    if (speed > 0 && !this._groundAhead(0.9)) {
      speed = 0;
      if (this.state === 'wander') {
        this.yaw += Math.PI;
        this._pickTarget();
      }
    }
    if (Math.abs(angleDelta(this.yaw, want)) > 1.2) speed *= 0.3;

    this.position.x += Math.sin(this.yaw) * speed * dt;
    this.position.z += Math.cos(this.yaw) * speed * dt;
    this.vy -= 30 * dt;
    this.position.y += this.vy * dt;
    const c = this.ctx.physics.resolveCapsule(this.position, this.radius, this.height, MASK, this._contact);
    if (c.grounded) {
      this.vy = 0;
      if (c.groundCollider?.delta) this.position.add(c.groundCollider.delta);
    }
    if (this.position.y < this.ctx.killY) this.remove = true;
    this.walkSpeed = speed;

    const res = heroContact(this, hero, this.position.y + this.height, this.radius);
    if (res === 'stomped') {
      this.defeat('stomped');
      hero.bounceOff(this.ctx.input.jumpHeld);
    } else if (res === 'attacked') {
      this.defeat('attacked');
    }
  }

  animate(dt, time) {
    this.object.position.copy(this.position);
    this.object.rotation.y = this.yaw;
    if (this.state === 'squashed') {
      const k = Math.min(1, this.stateTime / 0.1);
      this.object.scale.set(1 + k * 0.5, 1 - k * 0.8, 1 + k * 0.5);
      return;
    }
    const w = (this.walkSpeed || 0) > 0.1 ? time * (6 + this.walkSpeed * 3) : 0;
    this.feet[0].position.z = 0.05 + Math.sin(w) * 0.18;
    this.feet[1].position.z = 0.05 - Math.sin(w) * 0.18;
    this.body.position.y = Math.abs(Math.sin(w)) * 0.06;
    this.body.rotation.z = Math.sin(w) * 0.08;
  }
}

/**
 * Zumbón: a hovering drone. Patrols a circle around home, dives at the hero
 * when it has line of sight, and can be stomped from above.
 */
export class Flyer {
  constructor(ctx, home, { radius = 5 } = {}) {
    this.ctx = ctx;
    this.home = home.clone();
    this.position = home.clone();
    this.patrolRadius = radius;
    this.angle = Math.random() * Math.PI * 2;
    this.yaw = 0;
    this.state = 'patrol';
    this.stateTime = 0;
    this.alive = true;
    this.remove = false;
    this.radius = 0.6;
    this.object = new THREE.Group();
    this.shell = toonMesh(new THREE.IcosahedronGeometry(0.6, 2), { color: 0x4a4f63, rim: 0x9aa6ff, shadowTint: 0x2a2f55 }, this.object);
    this.eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshBasicMaterial({ color: 0x6cf0ff }));
    this.eye.position.set(0, 0.08, 0.5);
    this.eye.scale.set(1, 1, 0.5);
    this.object.add(this.eye);
    this.ring = toonMesh(new THREE.TorusGeometry(0.85, 0.06, 6, 28), { color: 0xc8cde0, rim: 0xffffff }, this.object);
    this.ring.rotation.x = Math.PI / 2;
    ctx.scene.add(this.object);
  }

  step(dt, hero) {
    this.stateTime += dt;
    if (!this.alive) {
      this.position.y -= dt * 8;
      this.object.rotation.z += dt * 10;
      if (this.stateTime > 0.6) this.remove = true;
      return;
    }
    const chest = hero.center;
    const dist = chest.distanceTo(this.position);
    const sees = dist < 13 && !hero.busy && this.ctx.physics.lineOfSight(this.position, chest);
    let target;
    let speed;
    if (this.state === 'patrol') {
      this.angle += dt * 0.5;
      target = _v.set(this.home.x + Math.cos(this.angle) * this.patrolRadius, this.home.y, this.home.z + Math.sin(this.angle) * this.patrolRadius);
      speed = 2.5;
      if (sees) {
        this.state = 'chase';
        this.stateTime = 0;
        this.ctx.emit('alert', this.position);
      }
    } else {
      target = _v.copy(chest);
      target.y = clamp(target.y, this.home.y - 3, this.home.y + 4);
      speed = 4.2;
      if (!sees && this.stateTime > 2) {
        this.state = 'patrol';
        this.stateTime = 0;
      }
      if (this.position.distanceTo(this.home) > 18) this.state = 'patrol';
    }
    const d = target.clone().sub(this.position);
    const len = d.length();
    if (len > 0.05) {
      this.yaw = dampAngle(this.yaw, Math.atan2(d.x, d.z), 5, dt);
      this.position.addScaledVector(d, Math.min(1, (speed * dt) / len));
    }
    this.position.y += Math.sin(this.stateTime * 3 + this.angle) * 0.01;

    const res = heroContact(this, hero, this.position.y + 0.55, this.radius + 0.1);
    if (res === 'stomped' || res === 'attacked') {
      this.alive = false;
      this.stateTime = 0;
      this.ctx.coins.drop(this.position, 2);
      this.ctx.emit('enemy-defeat', this.position);
      if (res === 'stomped') hero.bounceOff(this.ctx.input.jumpHeld);
    }
  }

  animate(dt) {
    this.object.position.copy(this.position);
    this.object.rotation.y = this.yaw;
    this.ring.rotation.z += dt * (this.state === 'chase' ? 8 : 2);
    this.eye.material.color.setHex(this.state === 'chase' ? 0xff3b3b : 0x6cf0ff);
  }
}

/**
 * Rey Pedrusco: the course boss. Walks toward the hero, winds up and
 * charges, and gets dizzy afterwards. Three stomps (or ground pounds) on the
 * crown defeat it. Contact from the side hurts.
 */
export class Golem {
  constructor(ctx, pos, { arenaRadius = 11, onDefeat } = {}) {
    this.ctx = ctx;
    this.home = pos.clone();
    this.position = pos.clone();
    this.arenaRadius = arenaRadius;
    this.onDefeat = onDefeat;
    this.hp = 3;
    this.yaw = 0;
    this.vy = 0;
    this.state = 'sleep';
    this.stateTime = 0;
    this.alive = true;
    this.remove = false;
    this.radius = 1.35;
    this.height = 2.6;
    this.chargeDir = new THREE.Vector3();
    this._contact = { normal: new THREE.Vector3() };
    this.object = new THREE.Group();
    const body = new THREE.Group();
    this.object.add(body);
    this.body = body;
    this.materials = [];
    const add = (geo, opts, x, y, z) => {
      const m = toonMesh(geo, opts, body, x, y, z);
      this.materials.push(m.material);
      return m;
    };
    add(new THREE.BoxGeometry(2.3, 2.0, 2.0), { color: 0x9d968a, rim: 0xe0dccf, shadowTint: 0x4a4658 }, 0, 1.3, 0);
    add(new THREE.BoxGeometry(0.7, 0.9, 0.7), { color: 0x8a8378, shadowTint: 0x4a4658 }, -0.6, 0.35, 0);
    add(new THREE.BoxGeometry(0.7, 0.9, 0.7), { color: 0x8a8378, shadowTint: 0x4a4658 }, 0.6, 0.35, 0);
    this.arms = [-1, 1].map((s) => add(new THREE.BoxGeometry(0.6, 1.3, 0.6), { color: 0x8a8378, shadowTint: 0x4a4658 }, s * 1.5, 1.3, 0));
    const crown = add(new THREE.CylinderGeometry(0.75, 0.9, 0.45, 8), { color: 0xffc83a, rim: 0xfff2b0, shadowTint: 0xa06010, emissive: 0x2a1800 }, 0, 2.52, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), crown.material);
      spike.position.set(Math.cos(a) * 0.72, 0.35, Math.sin(a) * 0.72);
      crown.add(spike);
    }
    angryEyes(body, 1.55, 1.01, 0.42, 0.2);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0x151515 }));
    mouth.position.set(0, 0.95, 1.01);
    body.add(mouth);
    this.dizzy = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0xffe36a }));
      s.position.set(Math.cos((i / 3) * Math.PI * 2) * 0.8, 0, Math.sin((i / 3) * Math.PI * 2) * 0.8);
      this.dizzy.add(s);
    }
    this.dizzy.position.y = 3.3;
    this.dizzy.visible = false;
    this.object.add(this.dizzy);
    ctx.scene.add(this.object);
  }

  get top() {
    return this.position.y + this.height;
  }

  wake() {
    if (this.state !== 'sleep') return;
    this.state = 'intro';
    this.stateTime = 0;
    this.ctx.emit('boss-wake', this.position);
  }

  _set(s) {
    this.state = s;
    this.stateTime = 0;
  }

  step(dt, hero) {
    this.stateTime += dt;
    const speedUp = 1 + (3 - this.hp) * 0.35;
    const toHero = new THREE.Vector3(hero.position.x - this.position.x, 0, hero.position.z - this.position.z);
    const dist = toHero.length();
    let move = 0;

    switch (this.state) {
      case 'sleep':
        if (dist < this.arenaRadius + 1 && !hero.busy) this.wake();
        break;
      case 'intro':
        if (this.stateTime < 0.3) this.vy = 8;
        if (this.stateTime > 1.6) this._set('walk');
        break;
      case 'walk':
        this.yaw = dampAngle(this.yaw, Math.atan2(toHero.x, toHero.z), 3 * speedUp, dt);
        move = 2.2 * speedUp;
        if (this.stateTime > 3.2 / speedUp) this._set('windup');
        break;
      case 'windup':
        this.yaw = dampAngle(this.yaw, Math.atan2(toHero.x, toHero.z), 6, dt);
        if (this.stateTime > 0.8) {
          this.chargeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          this._set('charge');
          this.ctx.emit('boss-charge', this.position);
        }
        break;
      case 'charge':
        move = 10 * Math.min(speedUp, 1.4);
        if (this.stateTime > 1.3) this._set('dizzy');
        break;
      case 'dizzy':
        if (this.stateTime > 2.2) this._set('walk');
        break;
      case 'hurt':
        if (this.stateTime > 1.1) this._set(this.hp > 0 ? 'walk' : 'dead');
        break;
      case 'dead':
        this.body.scale.multiplyScalar(1 - dt * 1.5);
        if (this.stateTime > 1 && this.alive) {
          this.alive = false;
          this.remove = true;
          this.ctx.coins.drop(this.position.clone().setY(this.position.y + 1), 6);
          this.onDefeat?.(this);
        }
        return;
    }

    if (move > 0) {
      this.position.x += Math.sin(this.yaw) * move * dt;
      this.position.z += Math.cos(this.yaw) * move * dt;
    }
    this.vy -= 30 * dt;
    this.position.y += this.vy * dt;
    const c = this.ctx.physics.resolveCapsule(this.position, this.radius, this.height, MASK, this._contact);
    if (c.grounded) {
      if (this.vy < -8) this.ctx.emit('boss-stomp', this.position);
      this.vy = 0;
    }
    if (c.wall && this.state === 'charge') this._set('dizzy');
    const off = new THREE.Vector3(this.position.x - this.home.x, 0, this.position.z - this.home.z);
    if (off.length() > this.arenaRadius - 1.5) {
      off.setLength(this.arenaRadius - 1.5);
      this.position.x = this.home.x + off.x;
      this.position.z = this.home.z + off.z;
      if (this.state === 'charge') this._set('dizzy');
    }

    if (this.state === 'sleep' || this.state === 'intro' || this.state === 'hurt' || this.state === 'dead') return;
    // Hero interaction: crown stomps hurt the boss; everything else hurts the hero.
    const p = hero.position;
    const dxz = Math.hypot(p.x - this.position.x, p.z - this.position.z);
    const overlapY = p.y < this.top + 0.2 && p.y + HERO.height > this.position.y;
    if (dxz < this.radius + HERO.radius && overlapY) {
      if (hero.isStomping(this.top) && dxz < this.radius + 0.2) {
        this.hp--;
        this._set('hurt');
        hero.pounding ? (hero.vy = 12, hero.setState('jump1')) : hero.bounceOff(true, true);
        this.ctx.emit('boss-hit', this.position, this.hp);
      } else if (hero.hurt(2, this.position)) {
        hero.speed = -10;
      }
    }
  }

  animate(dt, time) {
    this.object.position.copy(this.position);
    this.object.rotation.y = this.yaw;
    const s = this.state;
    const walk = s === 'walk' || s === 'charge' ? time * (s === 'charge' ? 16 : 6) : 0;
    this.body.rotation.z = s === 'windup' ? Math.sin(time * 40) * 0.05 : Math.sin(walk) * 0.06;
    this.body.rotation.x = s === 'charge' ? 0.25 : s === 'dizzy' ? Math.sin(time * 4) * 0.1 : 0;
    this.arms[0].rotation.x = s === 'windup' ? -2.4 : Math.sin(walk) * 0.5;
    this.arms[1].rotation.x = s === 'windup' ? -2.4 : -Math.sin(walk) * 0.5;
    this.dizzy.visible = s === 'dizzy';
    this.dizzy.rotation.y = time * 5;
    const flash = s === 'hurt' && Math.floor(time * 16) % 2 === 0 ? 0.7 : 0;
    for (const m of this.materials) m.uniforms.uFlash.value = flash;
    if (s === 'sleep') this.body.position.y = Math.sin(time * 1.5) * 0.03 - 0.05;
    else this.body.position.y = damp(this.body.position.y, 0, 8, dt);
  }
}

/** Rotating bar of fireballs around a pivot. */
export class FireBar {
  constructor(ctx, pivot, { length = 5, speed = 1.6, phase = 0 } = {}) {
    this.ctx = ctx;
    this.pivot = pivot.clone();
    this.length = length;
    this.speed = speed;
    this.angle = phase;
    this.alive = true;
    this.remove = false;
    this.object = new THREE.Group();
    this.object.position.copy(pivot);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.6, 10), createToonMaterial({ color: 0x6a6a78 }));
    post.position.y = -0.3;
    post.castShadow = true;
    this.object.add(post);
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xffa12e });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff3a0 });
    this.balls = [];
    for (let i = 1; i <= length; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), fireMat);
      b.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), coreMat));
      this.object.add(b);
      this.balls.push({ mesh: b, r: i * 0.72 });
    }
    ctx.scene.add(this.object);
  }

  step(dt, hero) {
    this.angle += this.speed * dt;
    const c = hero.center;
    for (const b of this.balls) {
      const x = this.pivot.x + Math.cos(this.angle) * b.r;
      const z = this.pivot.z + Math.sin(this.angle) * b.r;
      const dy = Math.max(0, Math.abs(c.y - this.pivot.y) - HERO.height / 2 + HERO.radius);
      if ((c.x - x) ** 2 + (c.z - z) ** 2 + dy * dy < (0.34 + HERO.radius) ** 2) {
        hero.hurt(1, new THREE.Vector3(x, c.y, z), { burn: true });
        break;
      }
    }
  }

  animate(dt, time) {
    this.balls.forEach((b, i) => {
      b.mesh.position.set(Math.cos(this.angle) * b.r, 0, Math.sin(this.angle) * b.r);
      b.mesh.scale.setScalar(1 + Math.sin(time * 20 + i) * 0.1);
    });
  }
}
