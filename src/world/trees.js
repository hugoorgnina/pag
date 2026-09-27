import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { InstancedLOD } from '../render/instancedLOD.js';

const TRUNK = 0x6b4a2f;
const LEAF_DARK = 0x2f6b3a;
const LEAF_MID = 0x3f8745;
const LEAF_LIGHT = 0x57a150;

function tint(geometry, color) {
  const c = new THREE.Color(color);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) c.toArray(colors, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** LOD0: stacked cones, ~100 triangles. */
function nearGeometry() {
  return mergeGeometries([
    tint(new THREE.CylinderGeometry(0.2, 0.3, 1.6, 7).translate(0, 0.8, 0), TRUNK),
    tint(new THREE.ConeGeometry(1.6, 2.2, 10).translate(0, 2.2, 0), LEAF_DARK),
    tint(new THREE.ConeGeometry(1.25, 1.9, 10).translate(0, 3.3, 0), LEAF_MID),
    tint(new THREE.ConeGeometry(0.85, 1.6, 10).translate(0, 4.3, 0), LEAF_LIGHT),
  ]);
}

/** LOD1: one cone and a stub trunk, roughly a third of the triangles. */
function midGeometry() {
  return mergeGeometries([
    tint(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 5).translate(0, 0.8, 0), TRUNK),
    tint(new THREE.ConeGeometry(1.55, 4.1, 6).translate(0, 3.1, 0), LEAF_MID),
  ]);
}

/** LOD2: two crossed quads with an alpha-tested silhouette — 4 triangles. */
function farGeometry() {
  const a = new THREE.PlaneGeometry(3.4, 5.2).translate(0, 2.6, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const g = mergeGeometries([a, b]);
  // Up-facing normals so both quads light like a canopy rather than flicker by angle.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function billboardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = hex(TRUNK);
  ctx.fillRect(28, 66, 8, 30);
  const tri = (cy, hw, h, color) => {
    ctx.fillStyle = hex(color);
    ctx.beginPath();
    ctx.moveTo(32, cy - h);
    ctx.lineTo(32 + hw, cy);
    ctx.lineTo(32 - hw, cy);
    ctx.closePath();
    ctx.fill();
  };
  tri(78, 31, 40, LEAF_DARK);
  tri(56, 24, 34, LEAF_MID);
  tri(36, 16, 30, LEAF_LIGHT);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createForest(matrices) {
  const solid = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const billboard = new THREE.MeshLambertMaterial({
    map: billboardTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const forest = new InstancedLOD(
    [
      { geometry: nearGeometry(), material: solid, distance: 38, castShadow: true },
      { geometry: midGeometry(), material: solid, distance: 85, castShadow: true },
      { geometry: farGeometry(), material: billboard, distance: 175 },
    ],
    matrices,
    { boundingRadius: 2.8, centerOffsetY: 2.6 },
  );
  forest.name = 'forest';
  return forest;
}
