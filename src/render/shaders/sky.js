import * as THREE from 'three';
import { SUN_DIRECTION } from './toon.js';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to the far plane
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSunDir;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 col = y > 0.0
      ? mix(uHorizon, uTop, pow(y, 0.55))
      : mix(uHorizon, uBottom, pow(-y, 0.4));
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += vec3(1.0, 0.9, 0.7) * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.25);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const SKY_HORIZON = new THREE.Color(0xbfe0f5);

export function createSky({ top = 0x2f7fd6, horizon = SKY_HORIZON, bottom = 0x6aa8c9 } = {}) {
  const material = new THREE.ShaderMaterial({
    name: 'SkyMaterial',
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uHorizon: { value: new THREE.Color(horizon) },
      uBottom: { value: new THREE.Color(bottom) },
      uSunDir: { value: SUN_DIRECTION.clone() },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
