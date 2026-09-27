import { Game } from './game.js';
import './style.css';

const canvas = document.getElementById('game');
try {
  window.game = new Game(canvas);
} catch (err) {
  console.error(err);
  document.getElementById('overlay-title').textContent = 'WebGL no disponible';
  document.getElementById('overlay-text').textContent = 'Este juego necesita un navegador con WebGL 2 activado.';
  document.getElementById('overlay-button').hidden = true;
}
