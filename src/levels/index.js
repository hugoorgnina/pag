import { buildHub } from './hub.js';
import { buildBrisa } from './brisa.js';
import { buildFortaleza } from './fortaleza.js';
import { buildCaldera } from './caldera.js';

/**
 * Course registry. Each course lists its stars (id → name) so menus can show
 * progress without building the level. `required` is the number of stars
 * needed to open the course's portal in the hub.
 */
export const LEVELS = {
  hub: {
    name: 'Plaza del Cielo',
    build: buildHub,
    music: 'hub',
    sky: { top: 0x2f7fd6, horizon: 0xbfe0f5, bottom: 0x9fc8f0 },
    fog: [90, 260],
    stars: [{ id: 'hub-torre', name: 'Lo alto de la Torre del Cielo' }],
  },
  brisa: {
    name: 'Colinas Brisa',
    build: buildBrisa,
    music: 'brisa',
    required: 0,
    sky: { top: 0x2f7fd6, horizon: 0xbfe0f5, bottom: 0x6aa8c9 },
    fog: [70, 230],
    stars: [
      { id: 'brisa-cima', name: 'La cima del Pico Brisa' },
      { id: 'brisa-rojas', name: 'Ocho monedas rojas en la pradera' },
      { id: 'brisa-rey', name: '¡Derrota al Rey Pedrusco!' },
    ],
  },
  fortaleza: {
    name: 'Fortaleza Celeste',
    build: buildFortaleza,
    music: 'fortaleza',
    required: 2,
    sky: { top: 0x5a8fe8, horizon: 0xf3e2f7, bottom: 0xf7d6e6 },
    fog: [80, 260],
    stars: [
      { id: 'fort-cima', name: 'Cima de la fortaleza' },
      { id: 'fort-rojas', name: 'Monedas rojas entre las nubes' },
      { id: 'fort-pozo', name: 'El pozo de los saltos de pared' },
    ],
  },
  caldera: {
    name: 'Caldera Ardiente',
    build: buildCaldera,
    music: 'caldera',
    required: 5,
    sky: { top: 0x2a0a0e, horizon: 0xff7a3d, bottom: 0x5a1408 },
    fog: [40, 170],
    fogColor: 0x8a3314,
    stars: [
      { id: 'cal-volcan', name: 'La corona del volcán' },
      { id: 'cal-rojas', name: 'Monedas rojas sobre la lava' },
      { id: 'cal-fuego', name: 'El islote de las barras de fuego' },
    ],
  },
};

export const COURSES = ['brisa', 'fortaleza', 'caldera'];
export const TOTAL_STARS = Object.values(LEVELS).reduce((n, l) => n + l.stars.length, 0);

export function starName(id) {
  for (const l of Object.values(LEVELS)) {
    const s = l.stars.find((x) => x.id === id);
    if (s) return s.name;
  }
  return id;
}
