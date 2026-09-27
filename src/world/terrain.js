import * as THREE from 'three';
import { clamp, createNoise2D, fbm, lerp, smoothstep } from '../core/math.js';

/**
 * Heightfield island. The same height grid drives the render mesh, the
 * collision queries and the water shader's shoreline foam, so what you see is
 * exactly what you stand on — without paying for a triangle-mesh collider.
 */
export class Terrain {
  constructor({ size = 240, segments = 192, seed = 1337, waterLevel = 0 } = {}) {
    this.size = size;
    this.half = size / 2;
    this.segments = segments;
    this.cell = size / segments;
    this.stride = segments + 1;
    this.waterLevel = waterLevel;

    this._noise = createNoise2D(seed);
    this._ridge = createNoise2D(seed + 1);
    this._tint = createNoise2D(seed + 2);

    this.heights = new Float32Array(this.stride * this.stride);
    this.minHeight = Infinity;
    this.maxHeight = -Infinity;
    for (let iz = 0; iz < this.stride; iz++) {
      for (let ix = 0; ix < this.stride; ix++) {
        const h = this.shape(-this.half + ix * this.cell, -this.half + iz * this.cell);
        this.heights[iz * this.stride + ix] = h;
        this.minHeight = Math.min(this.minHeight, h);
        this.maxHeight = Math.max(this.maxHeight, h);
      }
    }
  }

  /** Analytic island shape: rolling fBm hills, a flat central plaza, sinking coast. */
  shape(x, z) {
    const d = Math.hypot(x, z) / this.half;
    const hills = fbm(this._noise, x * 0.02 + 100, z * 0.02 + 100, 5);
    const r = 1 - Math.abs(this._ridge(x * 0.035, z * 0.035) * 2 - 1);
    let h = 2 + (hills - 0.4) * 21 + r * r * 3;
    h = lerp(h, 2.6, smoothstep(0.3, 0.14, d)); // plaza for the ruins
    h = lerp(h, -7, smoothstep(0.62, 0.95, d)); // coastline
    return h;
  }

  gridHeight(ix, iz) {
    return this.heights[iz * this.stride + ix];
  }

  /**
   * Height of the rendered surface at (x, z). Interpolates across the same
   * triangle the mesh uses, so feet never float or sink on slopes.
   */
  heightAt(x, z) {
    const max = this.segments - 1e-6;
    const gx = clamp((x + this.half) / this.cell, 0, max);
    const gz = clamp((z + this.half) / this.cell, 0, max);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = this.gridHeight(ix, iz);
    const h10 = this.gridHeight(ix + 1, iz);
    const h01 = this.gridHeight(ix, iz + 1);
    const h11 = this.gridHeight(ix + 1, iz + 1);
    if (fx > fz) return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    return h00 + (h01 - h00) * fz + (h11 - h01) * fx;
  }

  normalAt(x, z, target = new THREE.Vector3()) {
    const e = this.cell;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return target.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  isInside(x, z, margin = 0) {
    return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin;
  }

  createMesh() {
    const n = this.stride;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        positions[i * 3] = -this.half + ix * this.cell;
        positions[i * 3 + 1] = this.heights[i];
        positions[i * 3 + 2] = -this.half + iz * this.cell;
      }
    }

    const indices = new Uint32Array(this.segments * this.segments * 6);
    let k = 0;
    for (let iz = 0; iz < this.segments; iz++) {
      for (let ix = 0; ix < this.segments; ix++) {
        const a = iz * n + ix; // (ix, iz)
        const b = a + 1; // (ix+1, iz)
        const c = a + n; // (ix, iz+1)
        const d = c + 1; // (ix+1, iz+1)
        // Split along the a-d diagonal, matching heightAt(); wound for +Y normals.
        indices[k++] = a; indices[k++] = d; indices[k++] = b;
        indices[k++] = a; indices[k++] = c; indices[k++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    const normals = geometry.attributes.normal.array;
    const sand = new THREE.Color(0xd9c38f);
    const grassA = new THREE.Color(0x5f9d3d);
    const grassB = new THREE.Color(0x87b04a);
    const rock = new THREE.Color(0x8a8378);
    const seabed = new THREE.Color(0x9c8f6a);
    const c = new THREE.Color();
    for (let i = 0; i < n * n; i++) {
      const x = positions[i * 3];
      const h = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const slope = 1 - normals[i * 3 + 1];
      const tint = this._tint(x * 0.08, z * 0.08);
      c.copy(grassA).lerp(grassB, tint);
      c.lerp(sand, smoothstep(1.6, 0.7, h));
      c.lerp(seabed, smoothstep(-0.5, -3, h));
      c.lerp(rock, Math.max(smoothstep(0.22, 0.38, slope), smoothstep(11, 14, h)));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    // Lambert is noticeably cheaper than Standard and plenty for stylised terrain.
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  /** Low-precision height texture for the water shader (depth tint + shore foam). */
  createHeightTexture(min = -8, max = 4) {
    const n = this.stride;
    const data = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) {
      data[i] = Math.round(clamp((this.heights[i] - min) / (max - min), 0, 1) * 255);
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return { texture: tex, min, max };
  }
}
