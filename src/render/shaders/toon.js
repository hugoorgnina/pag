import * as THREE from 'three';

/**
 * Stylised toon shading: three hard light bands, a hard specular dot and a
 * rim light. Characters stand out against the softly lit Lambert world, which
 * is the whole point of writing a custom shader here — visual identity.
 */
const vertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vNormalW;
  varying vec3 vViewDirW;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDirW = cameraPosition - worldPos.xyz;
    vec4 mvPosition = viewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uColor;
  uniform vec3 uShadowTint;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uRimColor;
  uniform vec3 uEmissive;
  uniform float uFlash;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(vViewDirW);
    vec3 l = normalize(uSunDir);
    float ndl = dot(n, l);

    // Quantised diffuse: 3 bands with a thin smoothstep to avoid aliasing.
    float band = 0.45
      + 0.35 * smoothstep(-0.05, 0.0, ndl)
      + 0.20 * smoothstep(0.45, 0.5, ndl);
    vec3 col = uColor * mix(uShadowTint, uSunColor, band) * band;

    float spec = smoothstep(0.93, 0.95, dot(n, normalize(l + v)));
    col += uSunColor * spec * 0.35;

    float rim = smoothstep(0.62, 0.68, 1.0 - max(dot(n, v), 0.0));
    col += uRimColor * rim * (0.35 + 0.65 * step(0.0, ndl));

    col += uEmissive;
    col = mix(col, vec3(1.0, 0.25, 0.2), uFlash);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export const SUN_DIRECTION = new THREE.Vector3(0.55, 0.75, 0.35).normalize();

export function createToonMaterial({ color = 0xffffff, rim = 0xffffff, emissive = 0x000000, shadowTint = 0x5566aa } = {}) {
  return new THREE.ShaderMaterial({
    name: 'ToonMaterial',
    vertexShader,
    fragmentShader,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uColor: { value: new THREE.Color(color) },
        uShadowTint: { value: new THREE.Color(shadowTint) },
        uSunDir: { value: SUN_DIRECTION.clone() },
        uSunColor: { value: new THREE.Color(0xfff1d6) },
        uRimColor: { value: new THREE.Color(rim) },
        uEmissive: { value: new THREE.Color(emissive) },
        uFlash: { value: 0 },
      },
    ]),
  });
}
