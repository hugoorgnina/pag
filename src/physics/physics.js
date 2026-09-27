import * as THREE from 'three';
import { clamp } from '../core/math.js';

/**
 * Collision layers (bitmask). Queries pass a mask so e.g. the camera only
 * collides with level geometry and never with pickups or enemies.
 */
export const Layers = Object.freeze({
  STATIC: 1 << 0,
  TREE: 1 << 1,
  ENEMY: 1 << 2,
  PLAYER: 1 << 3,
  ALL: 0xffff,
});

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * Tiny purpose-built physics world: static boxes, spheres and vertical
 * cylinders in a uniform spatial hash, a short list of moving (dynamic)
 * colliders, an optional heightfield for the ground, capsule resolution for
 * characters and raycasts for line-of-sight and camera collision.
 * Simple colliders, complex visuals.
 */
export class PhysicsWorld {
  constructor(terrain = null, { cellSize = 8 } = {}) {
    this.terrain = terrain;
    this.cellSize = cellSize;
    this.cells = new Map();
    this.colliders = [];
    this.dynamic = [];
    this._stamp = 0;
    this._list = [];
  }

  _key(ix, iz) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  _insert(collider, x0, z0, x1, z1) {
    const cs = this.cellSize;
    for (let ix = Math.floor(x0 / cs); ix <= Math.floor(x1 / cs); ix++) {
      for (let iz = Math.floor(z0 / cs); iz <= Math.floor(z1 / cs); iz++) {
        const key = this._key(ix, iz);
        let cell = this.cells.get(key);
        if (!cell) this.cells.set(key, (cell = []));
        cell.push(collider);
      }
    }
    this.colliders.push(collider);
    return collider;
  }

  _make(type, props, { layer = Layers.STATIC, userData = null, kind = null } = {}) {
    return { type, ...props, layer, userData, kind, _stamp: 0, delta: null };
  }

  addBox(min, max, opts = {}) {
    const c = this._make('box', { min: min.clone(), max: max.clone() }, opts);
    return this._insert(c, c.min.x, c.min.z, c.max.x, c.max.z);
  }

  addSphere(center, radius, opts = {}) {
    const c = this._make('sphere', { center: center.clone(), radius }, opts);
    return this._insert(c, center.x - radius, center.z - radius, center.x + radius, center.z + radius);
  }

  /** Vertical cylinder: round platforms, towers, pillars. */
  addCylinder(x, z, y0, y1, radius, opts = {}) {
    const c = this._make('cylinder', { center: new THREE.Vector3(x, (y0 + y1) / 2, z), y0, y1, radius }, opts);
    return this._insert(c, x - radius, z - radius, x + radius, z + radius);
  }

  /**
   * Moving box collider. Not hashed: dynamic colliders are few, so they are
   * simply tested every query. `delta` holds this step's displacement so
   * characters standing on it can be carried along.
   */
  addDynamicBox(min, max, opts = {}) {
    const c = this._make('box', { min: min.clone(), max: max.clone() }, opts);
    c.dynamic = true;
    c.delta = new THREE.Vector3();
    this.dynamic.push(c);
    this.colliders.push(c);
    return c;
  }

  static bounds(c, out = { x0: 0, z0: 0, x1: 0, z1: 0 }) {
    if (c.type === 'box') {
      out.x0 = c.min.x; out.z0 = c.min.z; out.x1 = c.max.x; out.z1 = c.max.z;
    } else {
      out.x0 = c.center.x - c.radius; out.z0 = c.center.z - c.radius;
      out.x1 = c.center.x + c.radius; out.z1 = c.center.z + c.radius;
    }
    return out;
  }

  /** Broadphase: unique colliders overlapping an XZ rectangle and matching `mask`. */
  queryArea(x0, z0, x1, z1, mask = Layers.ALL, out = []) {
    out.length = 0;
    const stamp = ++this._stamp;
    const cs = this.cellSize;
    for (let ix = Math.floor(x0 / cs); ix <= Math.floor(x1 / cs); ix++) {
      for (let iz = Math.floor(z0 / cs); iz <= Math.floor(z1 / cs); iz++) {
        const cell = this.cells.get(this._key(ix, iz));
        if (!cell) continue;
        for (const c of cell) {
          if (c._stamp === stamp || !(c.layer & mask)) continue;
          c._stamp = stamp;
          out.push(c);
        }
      }
    }
    for (const c of this.dynamic) {
      if (!(c.layer & mask) || c.disabled) continue;
      if (c.max.x < x0 || c.min.x > x1 || c.max.z < z0 || c.min.z > z1) continue;
      out.push(c);
    }
    return out;
  }

  /**
   * Push a vertical capsule out of level geometry and the ground.
   * `pos` is the capsule's feet and is modified in place.
   * Result: grounded, groundCollider, hitCeiling, onTerrain, normal, wall, wallNormal, kinds.
   */
  resolveCapsule(pos, radius, height, mask = Layers.STATIC | Layers.TREE, result = {}) {
    result.grounded = false;
    result.hitCeiling = false;
    result.onTerrain = false;
    result.wall = false;
    result.groundCollider = null;
    result.normal = result.normal || new THREE.Vector3();
    result.normal.set(0, 1, 0);
    result.wallNormal = result.wallNormal || new THREE.Vector3();
    result.kinds = result.kinds || new Set();
    result.kinds.clear();

    for (let iter = 0; iter < 4; iter++) {
      let pushed = false;
      const list = this.queryArea(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, mask, this._list);
      for (const c of list) {
        const segA = pos.y + radius;
        const segB = pos.y + Math.max(height - radius, radius);
        let nx = 0, ny = 0, nz = 0, pen = 0;

        if (c.type === 'box' || c.type === 'cylinder') {
          const lo = c.type === 'box' ? c.min.y : c.y0;
          const hi = c.type === 'box' ? c.max.y : c.y1;
          // Closest points between a vertical segment and the solid.
          let ys;
          if (segB < lo) ys = segB;
          else if (segA > hi) ys = segA;
          else ys = (Math.max(segA, lo) + Math.min(segB, hi)) / 2;
          _p.set(pos.x, ys, pos.z);
          let inside = false;
          let hd = 0, hx = 0, hz = 0;
          if (c.type === 'box') {
            _q.set(clamp(_p.x, c.min.x, c.max.x), clamp(ys, lo, hi), clamp(_p.z, c.min.z, c.max.z));
          } else {
            hx = pos.x - c.center.x;
            hz = pos.z - c.center.z;
            hd = Math.hypot(hx, hz);
            if (hd > c.radius) _q.set(c.center.x + (hx / hd) * c.radius, clamp(ys, lo, hi), c.center.z + (hz / hd) * c.radius);
            else _q.set(pos.x, clamp(ys, lo, hi), pos.z);
          }
          _d.subVectors(_p, _q);
          const dist = _d.length();
          if (dist >= radius) continue;
          if (dist > 1e-6) {
            _d.multiplyScalar(1 / dist);
            nx = _d.x; ny = _d.y; nz = _d.z;
            pen = radius - dist;
          } else {
            inside = true;
          }
          if (inside) {
            // Segment axis is inside the solid: exit through the cheapest face.
            let options;
            if (c.type === 'box') {
              options = [
                [pos.x - c.min.x + radius, -1, 0, 0],
                [c.max.x - pos.x + radius, 1, 0, 0],
                [pos.z - c.min.z + radius, 0, 0, -1],
                [c.max.z - pos.z + radius, 0, 0, 1],
                [hi - pos.y, 0, 1, 0],
              ];
            } else {
              const ux = hd > 1e-6 ? hx / hd : 1;
              const uz = hd > 1e-6 ? hz / hd : 0;
              options = [
                [c.radius - hd + radius, ux, 0, uz],
                [hi - pos.y, 0, 1, 0],
              ];
            }
            let best = options[0];
            for (const o of options) if (o[0] < best[0]) best = o;
            [pen, nx, ny, nz] = best;
          }
        } else {
          const ys = clamp(c.center.y, segA, segB);
          _d.set(pos.x - c.center.x, ys - c.center.y, pos.z - c.center.z);
          const dist = _d.length();
          const r = radius + c.radius;
          if (dist >= r) continue;
          if (dist > 1e-6) {
            _d.multiplyScalar(1 / dist);
            nx = _d.x; ny = _d.y; nz = _d.z;
          } else {
            ny = 1;
          }
          pen = r - dist;
        }

        pos.x += nx * pen;
        pos.y += ny * pen;
        pos.z += nz * pen;
        pushed = true;
        if (c.kind) result.kinds.add(c.kind);
        if (ny > 0.6) {
          result.grounded = true;
          result.groundCollider = c;
          result.normal.set(nx, ny, nz);
        } else if (ny < -0.6) {
          result.hitCeiling = true;
        } else if (Math.abs(ny) < 0.35) {
          result.wall = true;
          const h = Math.hypot(nx, nz) || 1;
          result.wallNormal.set(nx / h, 0, nz / h);
        }
      }
      if (!pushed) break;
    }

    if (this.terrain) {
      const h = this.terrain.heightAt(pos.x, pos.z);
      if (pos.y <= h) {
        pos.y = h;
        result.grounded = true;
        result.onTerrain = true;
        result.groundCollider = null;
        this.terrain.normalAt(pos.x, pos.z, result.normal);
      }
    }
    return result;
  }

  _rayCollider(o, d, c) {
    if (c.type === 'box') return rayBox(o, d, c.min, c.max);
    if (c.type === 'sphere') return raySphere(o, d, c.center, c.radius);
    return rayCylinder(o, d, c);
  }

  /**
   * Nearest hit along a ray. Walks the spatial hash with a 2D DDA so only
   * cells the ray actually crosses are tested, then the dynamic colliders,
   * then optionally marches the heightfield. `dir` must be normalised.
   */
  raycast(origin, dir, maxDist, mask = Layers.STATIC, { terrain = true } = {}) {
    let best = maxDist;
    let hit = null;
    const cs = this.cellSize;
    const stamp = ++this._stamp;

    let ix = Math.floor(origin.x / cs);
    let iz = Math.floor(origin.z / cs);
    const stepX = dir.x > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = dir.x !== 0 ? cs / Math.abs(dir.x) : Infinity;
    const tDeltaZ = dir.z !== 0 ? cs / Math.abs(dir.z) : Infinity;
    let tMaxX = dir.x !== 0 ? ((ix + (stepX > 0 ? 1 : 0)) * cs - origin.x) / dir.x : Infinity;
    let tMaxZ = dir.z !== 0 ? ((iz + (stepZ > 0 ? 1 : 0)) * cs - origin.z) / dir.z : Infinity;

    let t = 0;
    while (t <= best) {
      const cell = this.cells.get(this._key(ix, iz));
      if (cell) {
        for (const c of cell) {
          if (c._stamp === stamp || !(c.layer & mask)) continue;
          c._stamp = stamp;
          const res = this._rayCollider(origin, dir, c);
          if (res && res.t < best) {
            best = res.t;
            hit = { distance: res.t, normal: res.normal, collider: c };
          }
        }
      }
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        ix += stepX;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        iz += stepZ;
      }
    }

    for (const c of this.dynamic) {
      if (!(c.layer & mask) || c.disabled) continue;
      const res = rayBox(origin, dir, c.min, c.max);
      if (res && res.t < best) {
        best = res.t;
        hit = { distance: res.t, normal: res.normal, collider: c };
      }
    }

    if (terrain && this.terrain) {
      const tt = this.raycastTerrain(origin, dir, best);
      if (tt !== null) {
        const px = origin.x + dir.x * tt;
        const pz = origin.z + dir.z * tt;
        hit = { distance: tt, normal: this.terrain.normalAt(px, pz), collider: null };
      }
    }

    if (hit) hit.point = new THREE.Vector3().copy(origin).addScaledVector(dir, hit.distance);
    return hit;
  }

  raycastTerrain(origin, dir, maxDist, step = 0.5) {
    const T = this.terrain;
    const above = (t) => origin.y + dir.y * t - T.heightAt(origin.x + dir.x * t, origin.z + dir.z * t);
    if (above(0) < 0) return null;
    let prev = 0;
    for (let t = step; ; t += step) {
      const tc = Math.min(t, maxDist);
      if (above(tc) < 0) {
        let lo = prev, hi = tc;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          if (above(mid) < 0) hi = mid;
          else lo = mid;
        }
        return lo;
      }
      if (tc >= maxDist) return null;
      prev = tc;
    }
  }

  /** Height of the first surface below `pos` (within maxDrop), or -Infinity. */
  groundBelow(pos, maxDrop = 50, mask = Layers.STATIC | Layers.TREE) {
    const o = new THREE.Vector3(pos.x, pos.y + 0.05, pos.z);
    const hit = this.raycast(o, DOWN, maxDrop, mask);
    return hit ? hit.point.y : -Infinity;
  }

  /** True if nothing blocks the segment a → b. */
  lineOfSight(a, b, mask = Layers.STATIC | Layers.TREE) {
    _d.subVectors(b, a);
    const dist = _d.length();
    if (dist < 1e-6) return true;
    _d.multiplyScalar(1 / dist);
    return this.raycast(a, _d.clone(), dist, mask) === null;
  }
}

const DOWN = new THREE.Vector3(0, -1, 0);

/** Slab test. Ignores boxes that contain the origin (e.g. camera already inside). */
export function rayBox(o, d, min, max) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = -1;
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    const oi = i === 0 ? o.x : i === 1 ? o.y : o.z;
    const di = i === 0 ? d.x : i === 1 ? d.y : d.z;
    const lo = i === 0 ? min.x : i === 1 ? min.y : min.z;
    const hi = i === 0 ? max.x : i === 1 ? max.y : max.z;
    if (Math.abs(di) < 1e-9) {
      if (oi < lo || oi > hi) return null;
      continue;
    }
    let t1 = (lo - oi) / di;
    let t2 = (hi - oi) / di;
    let s = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmin <= 0 || axis < 0) return null;
  const normal = new THREE.Vector3();
  normal.setComponent(axis, sign);
  return { t: tmin, normal };
}

export function raySphere(o, d, center, radius) {
  const ox = o.x - center.x, oy = o.y - center.y, oz = o.z - center.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c < 0) return null; // origin inside
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t <= 0) return null;
  const normal = new THREE.Vector3(ox + d.x * t, oy + d.y * t, oz + d.z * t).divideScalar(radius);
  return { t, normal };
}

/** Ray vs capped vertical cylinder. Ignores cylinders containing the origin. */
export function rayCylinder(o, d, c) {
  const ox = o.x - c.center.x;
  const oz = o.z - c.center.z;
  const r2 = c.radius * c.radius;
  if (ox * ox + oz * oz < r2 && o.y > c.y0 && o.y < c.y1) return null;
  let best = Infinity;
  let normal = null;
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-9) {
    const b = ox * d.x + oz * d.z;
    const cc = ox * ox + oz * oz - r2;
    const disc = b * b - a * cc;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = o.y + d.y * t;
      if (t > 0 && y >= c.y0 && y <= c.y1) {
        best = t;
        normal = new THREE.Vector3((ox + d.x * t) / c.radius, 0, (oz + d.z * t) / c.radius);
      }
    }
  }
  if (Math.abs(d.y) > 1e-9) {
    for (const [plane, ny] of [[c.y1, 1], [c.y0, -1]]) {
      const t = (plane - o.y) / d.y;
      if (t <= 0 || t >= best) continue;
      if ((ny > 0 && o.y < plane) || (ny < 0 && o.y > plane)) continue;
      const px = ox + d.x * t;
      const pz = oz + d.z * t;
      if (px * px + pz * pz <= r2) {
        best = t;
        normal = new THREE.Vector3(0, ny, 0);
      }
    }
  }
  return normal ? { t: best, normal } : null;
}
