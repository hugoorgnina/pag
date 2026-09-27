import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { texture } from '../render/textures.js';
import { Layers } from '../physics/physics.js';

const TILE = 2; // world units per texture repeat

/** Scale box UVs to world size; side faces are anchored to the top edge so grass fringes line up. */
function fitBoxUVs(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) {
    const side = f !== 2 && f !== 3;
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      const u = uv.getX(i) * (dims[f][0] / TILE);
      const vv = side ? 1 - (1 - uv.getY(i)) * (dims[f][1] / TILE) : uv.getY(i) * (dims[f][1] / TILE);
      uv.setXY(i, u, vv);
    }
  }
  return geo;
}

function fitCylinderUVs(geo, r, h, radial) {
  const uv = geo.attributes.uv;
  const sideCount = (radial + 1) * 2;
  const around = Math.max(1, Math.round((Math.PI * 2 * r) / TILE));
  for (let i = 0; i < uv.count; i++) {
    if (i < sideCount) uv.setXY(i, uv.getX(i) * around, 1 - (1 - uv.getY(i)) * (h / TILE));
    else uv.setXY(i, (uv.getX(i) - 0.5) * ((2 * r) / TILE), (uv.getY(i) - 0.5) * ((2 * r) / TILE));
  }
  return geo;
}

export function boxGeometry(w, h, d) {
  return fitBoxUVs(new THREE.BoxGeometry(w, h, d), w, h, d);
}

export function cylinderGeometry(r, h, radial = 24, rTop = r) {
  return fitCylinderUVs(new THREE.CylinderGeometry(rTop, r, h, radial, 1), r, h, radial);
}

const materialCache = new Map();
export function surface(name, color = 0xffffff) {
  const key = `${name}:${color}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshLambertMaterial({ map: texture(name), color }));
  }
  return materialCache.get(key);
}

/**
 * Builds level geometry. Static pieces sharing a surface are merged into one
 * mesh at `finish()` (static batching: a whole course is a handful of draw
 * calls), and every piece gets a simple box or cylinder collider.
 */
export class LevelBuilder {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.physics = ctx.physics;
    this.batches = new Map();
  }

  _batch(name, color, geo) {
    const key = `${name}:${color}`;
    if (!this.batches.has(key)) this.batches.set(key, { material: surface(name, color), geos: [] });
    this.batches.get(key).geos.push(geo);
  }

  /** Axis-aligned block; (x, z) is the centre, y the bottom. */
  block(x, y, z, w, h, d, { mat = 'stone', color = 0xffffff, collider = true, kind = null, layer = Layers.STATIC } = {}) {
    this._batch(mat, color, boxGeometry(w, h, d).translate(x, y + h / 2, z));
    if (!collider) return null;
    return this.physics.addBox(new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y + h, z + d / 2), { kind, layer });
  }

  /** Grass-topped earth block (the classic floating platform). */
  platform(x, y, z, w, h, d, { top = 'grass', side = 'dirt', color = 0xffffff } = {}) {
    this._batch(side, color, boxGeometry(w, h, d).translate(x, y + h / 2, z));
    this._batch(top, color, boxGeometry(w + 0.1, 0.14, d + 0.1).translate(x, y + h - 0.06, z));
    return this.physics.addBox(new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y + h, z + d / 2));
  }

  /** Vertical cylinder; (x, z) is the axis, y the bottom. */
  column(x, y, z, r, h, { mat = 'stone', top = null, color = 0xffffff, radial = 24, kind = null, collider = true, rTop = r } = {}) {
    this._batch(mat, color, cylinderGeometry(r, h, radial, rTop).translate(x, y + h / 2, z));
    if (top) this._batch(top, color, cylinderGeometry(rTop + 0.06, 0.14, radial).translate(x, y + h - 0.06, z));
    if (!collider) return null;
    return this.physics.addCylinder(x, z, y, y + h, Math.max(r, rTop), { kind });
  }

  /** Stairs from (x0, y0, z0) climbing `rise` per step toward (dx, dz). */
  stairs(x0, y0, z0, dx, dz, count, { rise = 0.6, run = 1.2, width = 3, mat = 'stone' } = {}) {
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    for (let i = 0; i < count; i++) {
      const x = x0 + ux * run * i;
      const z = z0 + uz * run * i;
      const w = Math.abs(ux) > 0.5 ? run : width;
      const d = Math.abs(ux) > 0.5 ? width : run;
      this.block(x, y0, z, w, rise * (i + 1), d, { mat });
    }
  }

  /** Springy pad: landing on it launches the hero high. */
  pad(x, y, z) {
    this._batch('pad', 0xffffff, cylinderGeometry(0.95, 0.3, 20).translate(x, y + 0.15, z));
    this._batch('metal', 0xffffff, cylinderGeometry(1.05, 0.12, 20).translate(x, y + 0.06, z));
    return this.physics.addCylinder(x, z, y, y + 0.3, 1.0, { kind: 'bounce' });
  }

  mover(opts) {
    const m = new Mover(this.physics, opts);
    this.scene.add(m.mesh);
    this.ctx.movers.push(m);
    return m;
  }

  finish() {
    for (const { material, geos } of this.batches.values()) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = 'static-batch';
      this.scene.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.batches.clear();
  }
}

/**
 * Moving platform following a path (ping-pong or loop) with short pauses at
 * the ends. Exposes `collider.delta` so riders are carried along.
 */
export class Mover {
  constructor(physics, { w = 3, h = 0.6, d = 3, mat = 'metal', top = null, path, speed = 2.5, wait = 0.6, loop = false, phase = 0, visual = true }) {
    this.path = path.map((p) => p.clone());
    this.speed = speed;
    this.wait = wait;
    this.loop = loop;
    this.size = new THREE.Vector3(w, h, d);
    const group = new THREE.Group();
    if (visual) {
      const body = new THREE.Mesh(boxGeometry(w, h, d), surface(mat));
      body.castShadow = body.receiveShadow = true;
      group.add(body);
    }
    if (visual && top) {
      const cap = new THREE.Mesh(boxGeometry(w + 0.1, 0.14, d + 0.1), surface(top));
      cap.position.y = h / 2 - 0.06;
      cap.receiveShadow = true;
      group.add(cap);
    }
    this.mesh = group;
    this.segment = 0;
    this.t = 0;
    this.dir = 1;
    this.pause = 0;
    this.center = this.path[0].clone();
    this.collider = physics.addDynamicBox(new THREE.Vector3(), new THREE.Vector3());
    this._place();
    // Advance to the starting phase (0..1 of the first leg).
    if (phase) this.update(phase * this.path[0].distanceTo(this.path[1]) / speed);
    this.collider.delta.set(0, 0, 0);
  }

  _place() {
    const c = this.center;
    const s = this.size;
    this.collider.min.set(c.x - s.x / 2, c.y - s.y / 2, c.z - s.z / 2);
    this.collider.max.set(c.x + s.x / 2, c.y + s.y / 2, c.z + s.z / 2);
    this.mesh.position.copy(c);
  }

  update(dt) {
    const prev = this.center.clone();
    if (this.pause > 0) {
      this.pause -= dt;
    } else {
      const a = this.path[this.segment];
      const nextIndex = this.loop ? (this.segment + 1) % this.path.length : this.segment + this.dir;
      const b = this.path[nextIndex];
      const len = a.distanceTo(b) || 1;
      this.t += (this.speed * dt) / len;
      if (this.t >= 1) {
        this.t = 0;
        this.segment = nextIndex;
        if (!this.loop && (this.segment === 0 || this.segment === this.path.length - 1)) {
          this.dir = this.segment === 0 ? 1 : -1;
          this.pause = this.wait;
        }
        this.center.copy(b);
      } else {
        this.center.lerpVectors(a, b, this.t);
      }
    }
    this._place();
    this.collider.delta.subVectors(this.center, prev);
  }
}
