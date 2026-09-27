import * as THREE from 'three';
import { SUN_DIRECTION } from './toon.js';

/**
 * Animated water. The vertex stage sums a few directional sine waves and
 * derives the normal analytically; the fragment stage samples the terrain
 * height texture to tint by depth and draw animated foam at the shoreline.
 */
const vertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  // (direction.xy, frequency, amplitude); speed derived from frequency.
  const vec4 WAVES[4] = vec4[4](
    vec4( 0.80,  0.60, 0.22, 0.16),
    vec4(-0.45,  0.89, 0.35, 0.09),
    vec4( 0.20, -0.98, 0.61, 0.05),
    vec4(-0.93, -0.37, 0.93, 0.03)
  );

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    float h = 0.0;
    vec2 grad = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      vec2 d = WAVES[i].xy;
      float f = WAVES[i].z;
      float a = WAVES[i].w;
      float phase = dot(d, world.xz) * f + uTime * sqrt(9.8 * f);
      h += a * sin(phase);
      grad += a * f * d * cos(phase);
    }
    world.y += h;
    vWorldPos = world.xyz;
    vNormalW = normalize(vec3(-grad.x, 1.0, -grad.y));
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform sampler2D uHeightMap;
  uniform float uTerrainSize;
  uniform float uHeightMin;
  uniform float uHeightMax;
  uniform vec3 uSunDir;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSky;
  uniform vec3 uFoam;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  void main() {
    vec2 uv = vWorldPos.xz / uTerrainSize + 0.5;
    float ground = mix(uHeightMin, uHeightMax, texture2D(uHeightMap, uv).r);
    float depth = max(vWorldPos.y - ground, 0.0);

    // Cheap procedural ripples perturb the normal for sparkle.
    vec2 rp = vWorldPos.xz * 1.7;
    vec3 ripple = vec3(
      sin(rp.x + uTime * 1.9) + sin(rp.y * 1.3 - uTime * 1.4),
      0.0,
      cos(rp.y + uTime * 1.6) + cos(rp.x * 0.8 + uTime * 1.1)
    ) * 0.035;
    // Fade high-frequency detail with distance, otherwise it aliases into moiré.
    float camDist = distance(cameraPosition, vWorldPos);
    ripple *= smoothstep(70.0, 8.0, camDist);
    vec3 n = normalize(mix(vNormalW, vec3(0.0, 1.0, 0.0), smoothstep(40.0, 160.0, camDist)) + ripple);
    vec3 v = normalize(cameraPosition - vWorldPos);

    vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 4.5, depth));
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    col = mix(col, uSky, fresnel * 0.65);

    vec3 hv = normalize(normalize(uSunDir) + v);
    col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, hv), 0.0), 220.0) * 2.5;

    float edge = smoothstep(0.45, 0.0, depth);
    float bands = step(0.78, fract(depth * 2.2 - uTime * 0.35 + sin(vWorldPos.x * 0.7) * 0.08));
    float foam = clamp(edge + bands * smoothstep(1.3, 0.2, depth) * 0.7, 0.0, 1.0);
    col = mix(col, uFoam, foam);

    float alpha = mix(0.72, 0.94, smoothstep(0.0, 2.5, depth));
    gl_FragColor = vec4(col, max(alpha, foam));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function createWater({ terrain, heightTexture }) {
  const extent = terrain.size * 3.5;
  const geometry = new THREE.PlaneGeometry(extent, extent, 160, 160);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    name: 'WaterMaterial',
    vertexShader,
    fragmentShader,
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uHeightMap: { value: null },
        uTerrainSize: { value: terrain.size },
        uHeightMin: { value: heightTexture.min },
        uHeightMax: { value: heightTexture.max },
        uSunDir: { value: SUN_DIRECTION.clone() },
        uShallow: { value: new THREE.Color(0x3fc6c0) },
        uDeep: { value: new THREE.Color(0x0d4f7a) },
        uSky: { value: new THREE.Color(0xbfe3ff) },
        uFoam: { value: new THREE.Color(0xf4fbff) },
      },
    ]),
  });
  // UniformsUtils.merge clones values; textures must be assigned afterwards.
  material.uniforms.uHeightMap.value = heightTexture.texture;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = terrain.waterLevel;
  mesh.name = 'water';
  mesh.renderOrder = 1;
  return mesh;
}
