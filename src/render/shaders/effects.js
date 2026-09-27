import * as THREE from 'three';

/** Molten lava: domain-warped noise, bright crusts, gentle heave. Unlit (it glows). */
const lavaVertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y += sin(world.x * 0.25 + uTime * 0.8) * 0.12 + cos(world.z * 0.3 + uTime * 0.6) * 0.12;
    vUv = world.xz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const lavaFragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    vec2 p = vUv * 0.18;
    vec2 warp = vec2(fbm(p + uTime * 0.05), fbm(p - uTime * 0.04 + 5.2));
    float n = fbm(p * 1.6 + warp * 1.8 + uTime * 0.03);
    vec3 dark = vec3(0.35, 0.03, 0.01);
    vec3 hot = vec3(1.0, 0.35, 0.02);
    vec3 white = vec3(1.0, 0.9, 0.45);
    vec3 col = mix(dark, hot, smoothstep(0.35, 0.6, n));
    col = mix(col, white, smoothstep(0.68, 0.8, n));
    col *= 1.3;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function createLava(size = 600, y = 0) {
  const geo = new THREE.PlaneGeometry(size, size, 120, 120).rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    name: 'LavaMaterial',
    vertexShader: lavaVertex,
    fragmentShader: lavaFragment,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = y;
  mesh.name = 'lava';
  return mesh;
}

/** Swirling portal surface for the hub's course gates. */
const portalVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const portalFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uLocked;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float a = atan(c.y, c.x);
    float swirl = sin(a * 5.0 + r * 10.0 - uTime * 3.0) * 0.5 + 0.5;
    vec3 col = mix(uColorA, uColorB, swirl);
    col += (1.0 - r) * 0.6;
    col = mix(col, vec3(0.25, 0.27, 0.33) + swirl * 0.05, uLocked);
    float alpha = smoothstep(1.0, 0.92, r);
    gl_FragColor = vec4(col, alpha * 0.92);
    #include <colorspace_fragment>
  }
`;

export function createPortalMaterial(colorA, colorB) {
  return new THREE.ShaderMaterial({
    name: 'PortalMaterial',
    vertexShader: portalVertex,
    fragmentShader: portalFragment,
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uLocked: { value: 0 },
    },
  });
}

/** Canvas-text sprite for signs floating above portals. */
export function textSprite(lines, { width = 512, height = 192, color = '#ffffff', bg = 'rgba(20,30,60,0.7)', scale = 4 } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  const r = 36;
  g.beginPath();
  g.roundRect(8, 8, width - 16, height - 16, r);
  g.fill();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((line, i) => {
    g.font = i === 0 ? '800 58px system-ui, sans-serif' : '700 46px system-ui, sans-serif';
    g.fillText(line, width / 2, height / (lines.length + 1) * (i + 1) + (i === 0 ? 4 : 0));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(scale, (scale * height) / width, 1);
  return sprite;
}
