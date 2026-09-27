import * as THREE from 'three';

/**
 * Additive fresnel glow for collectible orbs. Rendered as an InstancedMesh:
 * every orb is one instance, so all of them cost a single draw call. The
 * per-instance phase attribute desynchronises their pulsing.
 */
const vertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute float aPhase;
  uniform float uTime;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  varying float vPulse;

  void main() {
    vPulse = 0.5 + 0.5 * sin(uTime * 3.0 + aPhase);
    vec3 p = position * (1.0 + 0.08 * vPulse);
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vNormalW = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vViewDirW = cameraPosition - worldPos.xyz;
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uCore;
  uniform vec3 uGlow;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  varying float vPulse;

  void main() {
    float f = 1.0 - max(dot(normalize(vNormalW), normalize(vViewDirW)), 0.0);
    vec3 col = mix(uCore, uGlow, smoothstep(0.0, 0.7, f)) * (0.85 + 0.35 * vPulse);
    col += uGlow * pow(f, 3.0) * 0.8;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function createOrbMaterial() {
  return new THREE.ShaderMaterial({
    name: 'OrbMaterial',
    vertexShader,
    fragmentShader,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uCore: { value: new THREE.Color(0xffe08a) },
        uGlow: { value: new THREE.Color(0xff8a1f) },
      },
    ]),
  });
}
