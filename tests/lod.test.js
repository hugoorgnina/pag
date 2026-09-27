import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InstancedLOD, selectLevel } from '../src/render/instancedLOD.js';

test('selectLevel buckets by distance and culls beyond the last level', () => {
  const t = [30, 80, 170];
  assert.equal(selectLevel(5, t), 0);
  assert.equal(selectLevel(50, t), 1);
  assert.equal(selectLevel(100, t), 2);
  assert.equal(selectLevel(500, t), -1);
});

test('InstancedLOD frustum-culls and distributes instances', () => {
  const geo = new THREE.BoxGeometry();
  const mat = new THREE.MeshBasicMaterial();
  const matrices = [
    new THREE.Matrix4().makeTranslation(0, 0, -10), // near, in view
    new THREE.Matrix4().makeTranslation(0, 0, -60), // mid, in view
    new THREE.Matrix4().makeTranslation(0, 0, 60), // behind camera
    new THREE.Matrix4().makeTranslation(0, 0, -400), // too far
  ];
  const lod = new InstancedLOD(
    [
      { geometry: geo, material: mat, distance: 30 },
      { geometry: geo, material: mat, distance: 80 },
    ],
    matrices,
    { cullMargin: 0 },
  );
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.updateMatrixWorld();
  lod.update(camera);
  assert.deepEqual(lod.stats.levels, [1, 1]);
  assert.equal(lod.stats.culled, 2);
  assert.equal(lod.meshes[0].count, 1);
});
