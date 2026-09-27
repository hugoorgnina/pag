import * as THREE from 'three';
import { Input } from './core/input.js';
import { Sfx } from './core/audio.js';
import { clamp } from './core/math.js';
import { PhysicsWorld, Layers } from './physics/physics.js';
import { ThirdPersonCamera } from './camera/thirdPersonCamera.js';
import { Hero, HERO } from './entities/hero.js';
import { Coins, COIN_VALUE, Particles, Star } from './entities/collectibles.js';
import { LevelBuilder } from './world/builder.js';
import { createSky } from './render/shaders/sky.js';
import { SUN_DIRECTION } from './render/shaders/toon.js';
import { LEVELS, COURSES, TOTAL_STARS, starName } from './levels/index.js';

export const QUALITY = {
  high: { label: 'Alta', pixelRatio: 2, shadows: true, shadowMapSize: 2048, lodScale: 1 },
  low: { label: 'Baja', pixelRatio: 1, shadows: false, shadowMapSize: 1024, lodScale: 0.65 },
};

const FIXED_STEP = 1 / 60;
const SHADOW_EXTENT = 30;
const SAVE_KEY = 'pip-aventura-estelar';
const START_LIVES = 4;
const IDLE_INPUT = { move: { x: 0, y: 0 }, jump: false, jumpHeld: false, attack: false, crouch: false, crouchPressed: false };

function detectQuality() {
  const params = new URLSearchParams(location.search);
  if (params.get('quality') in QUALITY) return params.get('quality');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const weak = (navigator.hardwareConcurrency || 8) <= 4;
  return coarse || weak ? 'low' : 'high';
}

function loadSave() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return { stars: new Set(Array.isArray(data.stars) ? data.stars : []) };
  } catch {
    return { stars: new Set() };
  }
}

function writeSave(save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ stars: [...save.stars] }));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

/**
 * Top-level flow: title → hub ↔ courses, lives, stars, saving, HUD and the
 * fixed-step simulation loop.
 */
export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.qualityName = detectQuality();
    this.quality = QUALITY[this.qualityName];
    this.save = loadSave();
    this.lives = START_LIVES;
    this.mode = 'title'; // title | card | playing | paused | star | dying | menu
    this.time = 0;
    this.modeTime = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.qualityName === 'high', powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);

    this.hero = new Hero();
    this.input = new Input(canvas);
    this.sfx = new Sfx();
    this.rig = new ThirdPersonCamera(this.camera, new PhysicsWorld(null));
    this._sunBasis = new THREE.Matrix4().lookAt(SUN_DIRECTION, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    this._sunBasisInv = this._sunBasis.clone().invert();
    this.blob = this._createBlob();
    this.ui = this._bindUI();
    this._accumulator = 0;
    this._frames = 0;
    this._fpsTime = 0;
    this.fps = 0;
    this.debugVisible = false;
    this._lastHealth = -1;
    this._toastCooldown = 0;

    this.loadLevel('hub');
    this._showTitle();

    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'playing') this.pause();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.pointerLocked && this.mode === 'playing' && this._lockedOnce && !this.input.isTouch) this.pause();
      if (this.input.pointerLocked) this._lockedOnce = true;
    });
    this.resize();
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  get starCount() {
    return this.save.stars.size;
  }

  // ------------------------------------------------------------ levels

  loadLevel(id, { entry = null } = {}) {
    if (this.ctx) this._disposeLevel();
    const def = LEVELS[id];
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(def.fogColor ?? def.sky.horizon, def.fog[0], def.fog[1] * (0.75 + 0.25 * this.quality.lodScale));
    const sky = createSky(def.sky);
    scene.add(sky);

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a6b3a, 1.15);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_EXTENT;
    cam.right = cam.top = SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 180;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    scene.add(hemi, sun, sun.target);

    const physics = new PhysicsWorld(null);
    const ctx = {
      id, def, scene, physics, sky, sun,
      hero: this.hero,
      input: IDLE_INPUT,
      movers: [], enemies: [], hazards: [], stars: [], portals: [], lods: [], animated: [], updaters: [],
      killY: -30,
      redCollected: 0,
      coinsCollected: 0,
      emit: (event, pos, extra) => this._onEvent(event, pos, extra),
    };
    ctx.coins = new Coins(scene);
    ctx.particles = new Particles(scene);
    ctx.b = new LevelBuilder(ctx);
    ctx.addStar = (starId, pos, opts = {}) => {
      ctx.stars.push(new Star(scene, { id: starId, name: starName(starId), pos, hidden: opts.hidden, saved: this.save.stars.has(starId) }));
    };
    ctx.revealStar = (starId) => {
      const s = ctx.stars.find((x) => x.id === starId);
      if (s && !s.collected && s.reveal()) {
        this.sfx.play('reveal');
        this._toast('¡Ha aparecido una estrella!');
        ctx.particles.burst(s.pos, { count: 60, speed: 7, color: 0xffe36a });
      }
    };
    ctx.addEnemy = (e) => ctx.enemies.push(e);
    this.ctx = ctx;
    def.build(ctx, { levels: LEVELS, starCount: this.starCount });
    ctx.b.finish();

    scene.add(this.hero.object, this.blob);
    this.rig.physics = physics;
    this.rig.floorY = ctx.cameraFloor ?? -Infinity;
    let spawn = ctx.spawn;
    let facing = ctx.spawnFacing;
    if (entry && ctx.portals.length) {
      const portal = ctx.portals.find((p) => p.level === entry);
      if (portal) {
        const out = portal.pos.clone().setY(0).normalize().multiplyScalar(-3.5);
        spawn = portal.pos.clone().add(out).setY(0);
        facing = Math.atan2(-portal.pos.x, -portal.pos.z);
      }
    }
    this.hero.spawn(spawn, facing);
    this.hero.health = HERO.maxHealth;
    this.rig.yaw = facing + Math.PI;
    this.rig.pitch = 0.32;
    this.rig.snapTo(this.hero.position);
    this.applyQuality(this.qualityName, false);
    this.ui.courseName.textContent = def.name;
    this._lastHealth = -1;
    if (this.sfx.music) this.sfx.music.play(def.music);
  }

  _disposeLevel() {
    const scene = this.ctx.scene;
    scene.remove(this.hero.object, this.blob);
    scene.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
    this.ctx = null;
  }

  // ------------------------------------------------------------ flow & UI

  _bindUI() {
    const $ = (id) => document.getElementById(id);
    const ui = {
      overlay: $('overlay'),
      title: $('overlay-title'),
      text: $('overlay-text'),
      primary: $('overlay-button'),
      secondary: $('overlay-secondary'),
      hud: $('hud'),
      lives: $('lives'),
      stars: $('star-count'),
      coins: $('coin-count'),
      power: $('power'),
      red: $('red-counter'),
      toast: $('toast'),
      debug: $('debug'),
      quality: $('quality-label'),
      courseName: $('course-name'),
      touch: $('touch-controls'),
      fade: $('fade'),
    };
    ui.primary.addEventListener('click', () => this._overlayAction('primary'));
    ui.secondary.addEventListener('click', () => this._overlayAction('secondary'));
    ui.quality.parentElement.addEventListener('click', () => this.applyQuality(this.qualityName === 'high' ? 'low' : 'high'));
    this.canvas.addEventListener('click', () => {
      if (this.mode === 'playing' && !this.input.pointerLocked) this.input.requestPointerLock();
    });
    if (this.input.isTouch) ui.touch.hidden = false;
    return ui;
  }

  _overlay({ title, html, primary, secondary = null }) {
    const ui = this.ui;
    ui.title.textContent = title;
    ui.text.innerHTML = html;
    ui.primary.textContent = primary.label;
    ui.secondary.hidden = !secondary;
    if (secondary) ui.secondary.textContent = secondary.label;
    this._actions = { primary: primary.action, secondary: secondary?.action };
    ui.overlay.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _overlayAction(which) {
    this.sfx.unlock();
    const action = this._actions?.[which];
    if (action) action();
  }

  _hideOverlay() {
    this.ui.overlay.classList.add('hidden');
  }

  _resume() {
    this._hideOverlay();
    this.ui.hud.classList.remove('hidden');
    this.mode = 'playing';
    this.modeTime = 0;
    this.input.clearActions();
    this.input.requestPointerLock();
    if (this.sfx.music) this.sfx.music.play(this.ctx.boss?.state && !['sleep', 'dead'].includes(this.ctx.boss.state) ? 'boss' : this.ctx.def.music);
  }

  _showTitle() {
    this.mode = 'title';
    this.ui.hud.classList.add('hidden');
    const have = this.starCount;
    this._overlay({
      title: 'Pip: Aventura Estelar',
      html: `<p>Las estrellas que mantenían a flote el reino del cielo se han dispersado. Ayuda a <b>Pip</b> a recuperarlas en ${COURSES.length} mundos.</p>
        <ul class="controls">
          <li><kbd>W A S D</kbd> mover · <kbd>Ratón</kbd> cámara</li>
          <li><kbd>Espacio</kbd> saltar (encadena 3 para el triple salto)</li>
          <li><kbd>Shift</kbd> agacharse · en el aire: <b>culatazo</b></li>
          <li><kbd>E</kbd> / <kbd>Clic</kbd> puñetazo · corriendo: <b>plancha</b></li>
          <li>Corre + <kbd>Shift</kbd> + <kbd>Espacio</kbd> salto largo · quieto: voltereta atrás</li>
          <li>Salta contra una pared y pulsa <kbd>Espacio</kbd> otra vez: <b>salto de pared</b></li>
        </ul>
        <p class="progress">★ ${have} / ${TOTAL_STARS}</p>`,
      primary: { label: have ? 'Continuar' : 'Jugar', action: () => this._resume() },
      secondary: have ? { label: 'Nueva partida', action: () => this._confirmReset() } : null,
    });
  }

  _confirmReset() {
    this._overlay({
      title: '¿Borrar la partida?',
      html: `<p>Perderás las ${this.starCount} estrellas conseguidas.</p>`,
      primary: { label: 'Sí, empezar de cero', action: () => {
        this.save.stars.clear();
        writeSave(this.save);
        this.lives = START_LIVES;
        this.loadLevel('hub');
        this._resume();
      } },
      secondary: { label: 'Cancelar', action: () => this._showTitle() },
    });
  }

  pause() {
    this.mode = 'paused';
    this.sfx.play('pause');
    const inCourse = this.ctx.id !== 'hub';
    this._overlay({
      title: 'Pausa',
      html: `<p>${this.ctx.def.name} · ★ ${this.starCount} / ${TOTAL_STARS}</p>${this._starList(this.ctx.id)}`,
      primary: { label: 'Continuar', action: () => this._resume() },
      secondary: inCourse ? { label: 'Salir del nivel', action: () => this._exitCourse() } : { label: 'Menú principal', action: () => this._showTitle() },
    });
  }

  _starList(levelId) {
    const def = LEVELS[levelId];
    return `<ol class="star-list">${def.stars
      .map((s) => `<li class="${this.save.stars.has(s.id) ? 'got' : ''}"><span>${this.save.stars.has(s.id) ? '★' : '☆'}</span>${s.name}</li>`)
      .join('')}</ol>`;
  }

  _enterPortal(portal) {
    this.mode = 'card';
    this.sfx.play('portal');
    const def = LEVELS[portal.level];
    this._overlay({
      title: def.name,
      html: this._starList(portal.level),
      primary: { label: '¡Adelante!', action: () => {
        this.loadLevel(portal.level);
        this._resume();
      } },
      secondary: { label: 'Volver', action: () => {
        this.hero.position.addScaledVector(portal.pos.clone().setY(0).normalize(), -2.5);
        this.hero.speed = 0;
        this._resume();
      } },
    });
  }

  _exitCourse() {
    const from = this.ctx.id;
    this.loadLevel('hub', { entry: from });
    this._resume();
  }

  _toast(text) {
    this.ui.toast.textContent = text;
    this.ui.toast.classList.remove('show');
    void this.ui.toast.offsetWidth;
    this.ui.toast.classList.add('show');
  }

  // ------------------------------------------------------------ events

  _onEvent(event, pos, extra) {
    const ctx = this.ctx;
    switch (event) {
      case 'enemy-defeat':
        this.sfx.play('stomp');
        ctx.particles.burst(pos.clone().setY(pos.y + 0.5), { count: 24, speed: 5, color: 0xfff1c0 });
        break;
      case 'alert':
        this.sfx.play('alert');
        break;
      case 'boss-wake':
        this.sfx.play('boss');
        this.sfx.music?.play('boss');
        this._toast('¡El Rey Pedrusco despierta! Salta sobre su corona');
        break;
      case 'boss-charge':
        this.rig.addTrauma(0.25);
        break;
      case 'boss-stomp':
        this.rig.addTrauma(0.35);
        ctx.particles.burst(pos, { count: 30, speed: 6, color: 0xcfc3a8, up: 1 });
        break;
      case 'boss-hit':
        this.sfx.play('bosshit');
        this.rig.addTrauma(0.6);
        ctx.particles.burst(pos.clone().setY(pos.y + 2.6), { count: 40, speed: 8, color: 0xffe36a });
        if (extra > 0) this._toast(extra === 1 ? '¡Un golpe más!' : `¡Quedan ${extra} golpes!`);
        else {
          this._toast('¡Rey Pedrusco derrotado!');
          this.sfx.music?.play(ctx.def.music);
        }
        break;
    }
  }

  _heroEvents() {
    const h = this.hero;
    const ctx = this.ctx;
    for (const e of h.events.splice(0)) {
      switch (e) {
        case 'pound':
          this.sfx.play('pound');
          this.rig.addTrauma(0.3);
          ctx.particles.burst(h.position.clone().setY(h.position.y + 0.1), { count: 26, speed: 6, color: 0xe8e2d0, up: 0.5, gravity: 4 });
          break;
        case 'hurt':
        case 'burn':
          this.sfx.play(e);
          this.rig.addTrauma(0.5);
          if (e === 'burn') ctx.particles.burst(h.center, { count: 30, speed: 4, color: 0xff6a1a, up: 3 });
          break;
        case 'hardland':
          this.sfx.play('hardland');
          this.rig.addTrauma(0.5);
          this._toast('¡Aterrizaje duro!');
          break;
        case 'splash':
          this.sfx.play('splash');
          ctx.particles.burst(h.position.clone().setY(0.1), { count: 30, speed: 5, color: 0xbfe8ff });
          this._toast('¡Al agua! De vuelta a tierra firme');
          this.rig.snapTo(h.position);
          break;
        case 'dead':
          this._startDying('dead');
          break;
        case 'fallout':
          if (ctx.id === 'hub') {
            h.spawn(ctx.spawn, ctx.spawnFacing);
            this.rig.snapTo(h.position);
            this._toast('¡Cuidado con el borde!');
          } else {
            this._startDying('fallout');
          }
          break;
        case 'land':
          if (Math.abs(h.speed) > 6) ctx.particles.burst(h.position, { count: 6, speed: 2, color: 0xe8e2d0, up: 0.5, gravity: 2, life: 0.5 });
          this.sfx.play('land');
          break;
        case 'pound-start':
          break;
        default:
          this.sfx.play(e);
      }
    }
  }

  _startDying(reason) {
    if (this.mode === 'dying') return;
    this.mode = 'dying';
    this.modeTime = 0;
    this.sfx.music?.stop();
    this.sfx.play('die');
    if (reason === 'dead') this.hero.setState('dead');
    else this.hero.setState('dead');
    this.ui.fade.classList.add('show');
  }

  _finishDying() {
    this.lives--;
    this.ui.fade.classList.remove('show');
    if (this.lives <= 0) {
      this.lives = START_LIVES;
      this.loadLevel('hub');
      this.mode = 'menu';
      this._overlay({
        title: 'Fin del juego',
        html: `<p>Se acabaron las vidas, pero las estrellas conseguidas se quedan contigo.</p><p class="progress">★ ${this.starCount} / ${TOTAL_STARS}</p>`,
        primary: { label: 'Seguir jugando', action: () => this._resume() },
      });
      return;
    }
    this.loadLevel(this.ctx.id);
    this._toast(`Pip × ${this.lives}`);
    this._resume();
  }

  _collectStar(star) {
    star.collected = true;
    star.mesh.visible = false;
    const isNew = !this.save.stars.has(star.id);
    this.save.stars.add(star.id);
    writeSave(this.save);
    this.hero.collectStar();
    this.mode = 'star';
    this.modeTime = 0;
    this.sfx.music?.stop();
    this.sfx.play('star');
    this.ctx.particles.burst(star.pos, { count: 80, speed: 9, color: 0xffe36a });
    this._starGot = { star, isNew };
  }

  _afterStar() {
    const { star, isNew } = this._starGot;
    const inHub = this.ctx.id === 'hub';
    const all = this.starCount >= TOTAL_STARS && isNew;
    this.mode = 'menu';
    const html = `<p class="star-name">${star.name}</p><p class="progress">★ ${this.starCount} / ${TOTAL_STARS}</p>${
      isNew ? '' : '<p>Ya tenías esta estrella.</p>'
    }${all ? '<p><b>¡Has recuperado todas las estrellas!</b> El reino del cielo vuelve a brillar. ¡Gracias por jugar!</p>' : ''}${
      this._unlockMessage(isNew)
    }`;
    this._overlay({
      title: all ? '¡Victoria!' : '¡Estrella conseguida!',
      html,
      primary: { label: inHub ? 'Continuar' : 'Volver a la plaza', action: () => {
        if (inHub) {
          this.hero.setState('move');
          this._resume();
        } else {
          this._exitCourse();
        }
      } },
    });
  }

  _unlockMessage(isNew) {
    if (!isNew) return '';
    const opened = COURSES.filter((c) => LEVELS[c].required === this.starCount && LEVELS[c].required > 0);
    return opened.map((c) => `<p class="unlock">¡Se ha abierto el portal a <b>${LEVELS[c].name}</b>!</p>`).join('');
  }

  // ------------------------------------------------------------ quality

  applyQuality(name, recompile = true) {
    this.qualityName = name;
    this.quality = QUALITY[name];
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    if (this.ctx) {
      const sun = this.ctx.sun;
      sun.castShadow = q.shadows;
      sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      for (const lod of this.ctx.lods) lod.distanceScale = q.lodScale;
      if (recompile) {
        this.ctx.scene.traverse((o) => {
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
        });
      }
    }
    this.resize();
    this.ui.quality.textContent = q.label;
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ loop

  frame(timestamp) {
    this.timer.update(timestamp);
    const dt = clamp(this.timer.getDelta(), 0, 0.1);
    this.time += dt;
    this.modeTime += dt;
    this._toastCooldown -= dt;
    this._hotkeys();

    const look = this.input.consumeLook();
    if (this.mode === 'playing') {
      this.rig.applyLook(look);
      this._accumulator += dt;
      let steps = 0;
      // Presses are only consumed by a frame that actually simulates: on
      // 120/144 Hz screens many frames run zero steps, and reading input there
      // used to throw jumps away.
      let actions = null;
      while (this._accumulator >= FIXED_STEP && steps < 6 && this.mode === 'playing') {
        if (!actions) actions = this.input.consumeActions();
        this.step(FIXED_STEP, actions);
        actions.jump = actions.attack = actions.crouchPressed = false;
        this._accumulator -= FIXED_STEP;
        steps++;
      }
      if (steps === 6) this._accumulator = 0;
    } else {
      this.input.clearActions();
      if (this.mode === 'star' || this.mode === 'dying') {
        // Let the celebration / death animation play out.
        this.step(dt, IDLE_INPUT);
        if (this.mode === 'star' && this.modeTime > 2.4) this._afterStar();
        if (this.mode === 'dying' && this.modeTime > 2.2) this._finishDying();
      }
    }

    this._animate(dt);
    this._render(dt);
    this.input.endFrame();
  }

  step(dt, input) {
    const ctx = this.ctx;
    const h = this.hero;
    ctx.input = input;
    for (const m of ctx.movers) m.update(dt);
    h.step(dt, input, this.rig, ctx);
    if (this.mode !== 'playing') {
      h.events.length = 0;
      return;
    }
    for (const e of ctx.enemies) e.step(dt, h);
    for (const z of ctx.hazards) z.step(dt, h);
    for (const u of ctx.updaters) u(dt);
    for (let i = ctx.enemies.length - 1; i >= 0; i--) {
      if (ctx.enemies[i].remove) {
        ctx.scene.remove(ctx.enemies[i].object);
        ctx.enemies.splice(i, 1);
      }
    }

    // Coins: heal, count, red-coin progress, extra lives every 50.
    const got = ctx.coins.collect(h.center, HERO.height / 2 - HERO.radius, HERO.radius);
    for (const c of got) {
      const before = ctx.coinsCollected;
      ctx.coinsCollected += COIN_VALUE[c.type];
      h.heal(COIN_VALUE[c.type]);
      ctx.particles.burst(c.pos, { count: 10, speed: 3, color: c.type === 'red' ? 0xff6060 : c.type === 'blue' ? 0x70a8ff : 0xffe066, life: 0.5 });
      if (c.type === 'red') {
        ctx.redCollected++;
        this.sfx.play('red', ctx.redCollected);
        this._redPopup(ctx.redCollected, ctx.coins.redTotal);
        if (ctx.redCollected === ctx.coins.redTotal) ctx.onRedCoins?.();
      } else {
        this.sfx.play('coin');
      }
      if (ctx.id !== 'hub' && Math.floor(ctx.coinsCollected / 50) > Math.floor(before / 50)) {
        this.lives++;
        this.sfx.play('oneup');
        this._toast('¡Vida extra!');
      }
    }

    for (const s of ctx.stars) if (s.touches(h.center, HERO.height / 2, HERO.radius)) this._collectStar(s);

    for (const p of ctx.portals) {
      const d = Math.hypot(h.position.x - p.pos.x, h.position.z - p.pos.z);
      if (d < 1.7 && h.position.y < p.pos.y + 3 && h.position.y > p.pos.y - 0.6 && this.mode === 'playing') {
        if (p.locked) {
          if (this._toastCooldown <= 0) {
            this.sfx.play('locked');
            this._toast(`Necesitas ★ ${p.required} para entrar (tienes ${this.starCount})`);
            this._toastCooldown = 2.5;
          }
        } else {
          this._enterPortal(p);
        }
      }
    }

    this._heroEvents();
  }

  _redPopup(n, total) {
    const el = this.ui.red;
    el.textContent = `Moneda roja ${n} / ${total}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  _hotkeys() {
    const i = this.input;
    if (i.wasPressed('KeyQ')) this.applyQuality(this.qualityName === 'high' ? 'low' : 'high');
    if (i.wasPressed('F3') || i.wasPressed('Backquote')) {
      this.debugVisible = !this.debugVisible;
      this.ui.debug.hidden = !this.debugVisible;
    }
    if (i.wasPressed('KeyH')) this._toggleColliders();
    if (i.wasPressed('KeyM')) this._toast(this.sfx.toggleMute() ? 'Sonido desactivado' : 'Sonido activado');
    if ((i.wasPressed('KeyP') || i.wasPressed('Escape')) && this.mode === 'playing') this.pause();
  }

  _toggleColliders() {
    const ctx = this.ctx;
    if (!ctx.colliderHelpers) {
      const group = new THREE.Group();
      const mat = new THREE.LineBasicMaterial({ color: 0x00ff88 });
      const tree = new THREE.LineBasicMaterial({ color: 0xffee55 });
      const box = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
      const sphere = new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 10, 6));
      const cyl = new THREE.EdgesGeometry(new THREE.CylinderGeometry(1, 1, 1, 16));
      for (const c of ctx.physics.colliders) {
        if (c.dynamic) continue;
        const line = new THREE.LineSegments(c.type === 'box' ? box : c.type === 'sphere' ? sphere : cyl, c.layer & Layers.TREE ? tree : mat);
        if (c.type === 'box') {
          line.position.addVectors(c.min, c.max).multiplyScalar(0.5);
          line.scale.subVectors(c.max, c.min);
        } else if (c.type === 'sphere') {
          line.position.copy(c.center);
          line.scale.setScalar(c.radius);
        } else {
          line.position.copy(c.center);
          line.scale.set(c.radius, c.y1 - c.y0, c.radius);
        }
        group.add(line);
      }
      ctx.colliderHelpers = group;
      ctx.scene.add(group);
      this._toast(`${ctx.physics.colliders.length} colisionadores (H para ocultar)`);
      return;
    }
    ctx.colliderHelpers.visible = !ctx.colliderHelpers.visible;
  }

  _createBlob() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    mesh.geometry.userData.shared = true;
    mesh.renderOrder = 2;
    return mesh;
  }

  /** Blob shadow under the hero: the classic depth cue for platforming. */
  _updateBlob() {
    const p = this.hero.position;
    const hit = this.ctx.physics.raycast(new THREE.Vector3(p.x, p.y + 0.1, p.z), new THREE.Vector3(0, -1, 0), 60, Layers.STATIC | Layers.TREE);
    let ground = hit ? hit.point.y : -Infinity;
    if (this.ctx.lavaY !== undefined) ground = Math.max(ground, this.ctx.lavaY);
    if (this.ctx.waterLevel !== undefined) ground = Math.max(ground, this.ctx.waterLevel);
    this.blob.visible = Number.isFinite(ground) && this.mode !== 'title';
    if (!this.blob.visible) return;
    const height = p.y - ground;
    const s = clamp(1.2 - height * 0.04, 0.4, 1.2);
    this.blob.position.set(p.x, ground + 0.04, p.z);
    this.blob.scale.setScalar(s);
    this.blob.material.opacity = clamp(1 - height * 0.03, 0.35, 1);
  }

  _updateSun(focus) {
    const sun = this.ctx.sun;
    const texel = (SHADOW_EXTENT * 2) / this.quality.shadowMapSize;
    const p = focus.clone().applyMatrix4(this._sunBasisInv);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(this._sunBasis);
    sun.target.position.copy(p);
    sun.position.copy(p).addScaledVector(SUN_DIRECTION, 90);
  }

  _animate(dt) {
    const ctx = this.ctx;
    const h = this.hero;
    h.animate(dt, this.time);
    for (const e of ctx.enemies) e.animate(dt, this.time);
    for (const z of ctx.hazards) z.animate(dt, this.time);
    for (const s of ctx.stars) s.update(dt, this.time);
    for (const p of ctx.portals) p.material.uniforms.uTime.value = this.time;
    for (const m of ctx.animated) m.uniforms.uTime.value = this.time;
    ctx.coins.update(dt, this.time);
    ctx.particles.update(dt);

    if (this.mode === 'title') {
      const a = this.time * 0.08;
      this.camera.position.set(Math.sin(a) * 38, 16, Math.cos(a) * 38);
      this.camera.lookAt(0, 6, 0);
    } else {
      const speed01 = clamp(Math.abs(h.speed) / HERO.runSpeed, 0, 1.6);
      if (this.mode === 'playing' && !h.inAir) this.rig.follow(dt, h.facing, speed01);
      this.rig.update(dt, h.position, h.velocity, clamp(speed01 - 0.9, 0, 1));
    }
    ctx.sky.position.copy(this.camera.position);
    this._updateSun(this.mode === 'title' ? new THREE.Vector3() : h.position);
    this._updateBlob();

    // HUD
    const ui = this.ui;
    ui.lives.textContent = this.lives;
    ui.stars.textContent = this.starCount;
    ui.coins.textContent = ctx.coinsCollected;
    if (h.health !== this._lastHealth) {
      this._drawPower(h.health);
      this._lastHealth = h.health;
    }
    ui.power.classList.toggle('full', h.health >= HERO.maxHealth && h.invulnerable <= 0);
  }

  /** Pie-style power meter: 8 wedges, coloured by how many remain. */
  _drawPower(health) {
    const cvs = this.ui.power;
    const g = cvs.getContext('2d');
    const s = cvs.width;
    const c = s / 2;
    g.clearRect(0, 0, s, s);
    g.fillStyle = 'rgba(20, 24, 40, 0.75)';
    g.beginPath();
    g.arc(c, c, c - 2, 0, Math.PI * 2);
    g.fill();
    const color = health >= 7 ? '#3f8cff' : health >= 5 ? '#3fd35a' : health >= 3 ? '#ffd23a' : '#ff4b4b';
    for (let i = 0; i < HERO.maxHealth; i++) {
      const a0 = -Math.PI / 2 + (i / HERO.maxHealth) * Math.PI * 2 + 0.04;
      const a1 = -Math.PI / 2 + ((i + 1) / HERO.maxHealth) * Math.PI * 2 - 0.04;
      g.fillStyle = i < health ? color : 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.moveTo(c, c);
      g.arc(c, c, c - 8, a0, a1);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#fff';
    g.font = `800 ${Math.round(s * 0.3)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 4;
    g.strokeText(String(health), c, c + 1);
    g.fillText(String(health), c, c + 1);
  }

  _render(dt) {
    this.camera.updateMatrixWorld();
    for (const lod of this.ctx.lods) lod.update(this.camera);
    this.renderer.render(this.ctx.scene, this.camera);
    this._frames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 0.5) {
      this.fps = Math.round(this._frames / this._fpsTime);
      this._frames = 0;
      this._fpsTime = 0;
      if (this.debugVisible) this._updateDebug();
    }
  }

  _updateDebug() {
    const info = this.renderer.info.render;
    const h = this.hero;
    this.ui.debug.textContent = [
      `FPS        ${this.fps}`,
      `Draw calls ${info.calls}`,
      `Triángulos ${info.triangles.toLocaleString()}`,
      `Calidad    ${this.quality.label} (Q)`,
      `Nivel      ${this.ctx.def.name}`,
      `Estado     ${h.state}  vel ${h.speed.toFixed(1)}  vy ${h.vy.toFixed(1)}`,
      `Posición   ${h.position.toArray().map((v) => v.toFixed(1)).join(', ')}`,
      `Colisión   ${this.ctx.physics.colliders.length} (H)`,
    ].join('\n');
  }
}
