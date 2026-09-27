import * as THREE from 'three';

const _frustum = new THREE.Frustum();
const _viewProj = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

/** Index of the first LOD level whose distance threshold exceeds `distance`, or -1 if beyond all. */
export function selectLevel(distance, thresholds) {
  for (let i = 0; i < thresholds.length; i++) if (distance < thresholds[i]) return i;
  return -1;
}

/**
 * Frustum culling + distance LOD + batching in one system.
 *
 * Every level is a single InstancedMesh (one draw call per level regardless of
 * how many trees there are). Each frame, instances are tested against the
 * camera frustum on the CPU, bucketed by distance, and packed into the level
 * buffers. Instances past the last threshold are dropped entirely (fog hides
 * the pop).
 */
export class InstancedLOD extends THREE.Group {
  /**
   * @param {{geometry, material, distance:number, castShadow?:boolean}[]} levels near → far
   * @param {THREE.Matrix4[]} matrices per-instance transforms
   */
  constructor(levels, matrices, { boundingRadius = 1, centerOffsetY = 0, cullMargin = 4 } = {}) {
    super();
    this.matrices = matrices;
    this.cullMargin = cullMargin;
    this.distanceScale = 1;
    this.baseThresholds = levels.map((l) => l.distance);
    this.centers = matrices.map((m) =>
      new THREE.Vector3().setFromMatrixPosition(m).add(new THREE.Vector3(0, centerOffsetY * m.getMaxScaleOnAxis(), 0)),
    );
    this.radii = matrices.map((m) => boundingRadius * m.getMaxScaleOnAxis());
    this.meshes = levels.map((level) => {
      const mesh = new THREE.InstancedMesh(level.geometry, level.material, matrices.length);
      mesh.count = 0;
      mesh.frustumCulled = false; // we cull per instance ourselves
      mesh.castShadow = !!level.castShadow;
      mesh.receiveShadow = !!level.receiveShadow;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.add(mesh);
      return mesh;
    });
    this.stats = { levels: levels.map(() => 0), culled: 0, total: matrices.length };
    this._thresholds = [...this.baseThresholds];
  }

  update(camera) {
    _viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProj);
    for (let i = 0; i < this._thresholds.length; i++) {
      this._thresholds[i] = this.baseThresholds[i] * this.distanceScale;
    }

    const counts = this.stats.levels.fill(0);
    let culled = 0;
    const camPos = camera.position;
    for (let i = 0; i < this.matrices.length; i++) {
      _sphere.center.copy(this.centers[i]);
      _sphere.radius = this.radii[i] + this.cullMargin;
      if (!_frustum.intersectsSphere(_sphere)) {
        culled++;
        continue;
      }
      const level = selectLevel(this.centers[i].distanceTo(camPos), this._thresholds);
      if (level < 0) {
        culled++;
        continue;
      }
      this.meshes[level].setMatrixAt(counts[level]++, this.matrices[i]);
    }
    for (let l = 0; l < this.meshes.length; l++) {
      this.meshes[l].count = counts[l];
      this.meshes[l].instanceMatrix.needsUpdate = true;
    }
    this.stats.culled = culled;
  }
}
