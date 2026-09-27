import { Game } from './game.js';
import './style.css';

const canvas = document.getElementById('game');
try {
  window.game = new Game(canvas);
} catch (err) {
  console.error(err);
  document.getElementById('overlay-title').textContent = 'WebGL unavailable';
  document.getElementById('overlay-text').textContent = 'This game needs a browser with WebGL 2 enabled.';
  document.getElementById('overlay-button').hidden = true;
}
