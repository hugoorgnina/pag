import * as THREE from 'three';

/**
 * Procedural canvas textures, generated once and shared by every level.
 * Keeps the game asset-free and gives surfaces the chunky, toy-like look
 * of early 3D platformers.
 */
const cache = new Map();

function canvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

const noiseDots = (g, s, color, n, r = 1.5) => {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 12345.678) % 1;
    g.fillRect(Math.abs(x) * s, Math.abs(y) * s, r, r);
  }
};

const makers = {
  checker: () => canvas(64, (g, s) => {
    g.fillStyle = '#f3f0e6';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#d8d2c0';
    g.fillRect(0, 0, s / 2, s / 2);
    g.fillRect(s / 2, s / 2, s / 2, s / 2);
  }),
  checkerBlue: () => canvas(64, (g, s) => {
    g.fillStyle = '#7fb7ff';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#5a93e6';
    g.fillRect(0, 0, s / 2, s / 2);
    g.fillRect(s / 2, s / 2, s / 2, s / 2);
  }),
  grass: () => canvas(64, (g, s) => {
    g.fillStyle = '#5fbf3f';
    g.fillRect(0, 0, s, s);
    noiseDots(g, s, '#4fa834', 140, 2);
    noiseDots(g, s, '#79d152', 80, 2);
  }),
  dirt: () => canvas(64, (g, s) => {
    g.fillStyle = '#a8703f';
    g.fillRect(0, 0, s, s);
    noiseDots(g, s, '#8d5a30', 120, 3);
    noiseDots(g, s, '#bf8650', 60, 2);
    g.fillStyle = '#5fbf3f';
    g.fillRect(0, 0, s, 5);
    for (let x = 0; x < s; x += 6) g.fillRect(x, 5, 3, 3 + ((x * 7) % 5));
  }),
  stone: () => canvas(64, (g, s) => {
    g.fillStyle = '#b9b3a6';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#8e887c';
    g.lineWidth = 2;
    for (let row = 0; row < 4; row++) {
      const y = row * 16;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(s, y);
      g.stroke();
      const off = row % 2 ? 16 : 0;
      for (let x = off; x < s; x += 32) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 16);
        g.stroke();
      }
    }
    noiseDots(g, s, 'rgba(0,0,0,0.08)', 90, 2);
  }),
  brick: () => canvas(64, (g, s) => {
    g.fillStyle = '#c4553b';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#e8d9c0';
    for (let row = 0; row < 4; row++) {
      g.fillRect(0, row * 16, s, 2);
      const off = row % 2 ? 16 : 0;
      for (let x = off; x < s; x += 32) g.fillRect(x, row * 16, 2, 16);
    }
  }),
  wood: () => canvas(64, (g, s) => {
    g.fillStyle = '#c28a4e';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#9c6a35';
    for (let x = 0; x < s; x += 16) g.fillRect(x, 0, 2, s);
    g.fillStyle = 'rgba(0,0,0,0.1)';
    for (let y = 5; y < s; y += 11) g.fillRect(0, y, s, 1);
  }),
  cloud: () => canvas(32, (g, s) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, s, s);
    noiseDots(g, s, '#e8f1ff', 40, 3);
  }),
  basalt: () => canvas(64, (g, s) => {
    g.fillStyle = '#4a3a3a';
    g.fillRect(0, 0, s, s);
    noiseDots(g, s, '#382a2a', 160, 3);
    noiseDots(g, s, '#6b4a3a', 60, 2);
    g.strokeStyle = 'rgba(255,120,40,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(5, 60);
    g.lineTo(20, 40);
    g.lineTo(18, 22);
    g.lineTo(34, 8);
    g.stroke();
  }),
  metal: () => canvas(64, (g, s) => {
    g.fillStyle = '#9aa3b5';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#7a8295';
    g.fillRect(0, 0, s, 3);
    g.fillRect(0, 0, 3, s);
    g.fillStyle = '#c8cfdc';
    for (const [x, y] of [[8, 8], [56, 8], [8, 56], [56, 56]]) {
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  }),
  pad: () => canvas(64, (g, s) => {
    g.fillStyle = '#ff5fa2';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#ffe14d';
    g.beginPath();
    g.moveTo(s / 2, 8);
    g.lineTo(s - 12, s / 2);
    g.lineTo(s / 2 + 8, s / 2);
    g.lineTo(s / 2 + 8, s - 8);
    g.lineTo(s / 2 - 8, s - 8);
    g.lineTo(s / 2 - 8, s / 2);
    g.lineTo(12, s / 2);
    g.closePath();
    g.fill();
  }),
};

export function texture(name) {
  if (!cache.has(name)) cache.set(name, makers[name]());
  return cache.get(name);
}

export const TEXTURE_NAMES = Object.keys(makers);
