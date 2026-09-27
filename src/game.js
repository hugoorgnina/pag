import * as THREE from 'three';
import { Input } from './core/input.js';
import { Sfx } from './core/audio.js';
import { clamp } from './core/math.js';
import { Terrain } from './world/terrain.js';
import { buildLevel, updateLevelLights } from './world/level.js';
import { PhysicsWorld, Layers } from './physics/physics.js';
import { ThirdPersonCamera } from './camera/thirdPersonCamera.js';
import { Player, PLAYER } from './entities/player.js';
import { Sentinel } from './entities/sentinel.js';
import { Orbs, Particles } from './entities/orbs.js';
import { createWater } from './render/shaders/water.js';
import { createSky, SKY_HORIZON } from './render/shaders/sky.js';
import { SUN_DIRECTION } from './render/shaders/toon.js';

export const QUALITY = {
  high: { label: 'High', pixelRatio: 2, shadows: true, shadowMapSize: 2048, spotLights: true, lodScale: 1 },
  low: { label: 'Low', pixelRatio: 1, shadows: false, shadowMapSize: 1024, spotLights: false, lodScale: 0.65 },
};

const FIXED_STEP = 1 / 60;
const SHADOW_EXTENT = 32;
const BEST_KEY = 'orb-runner-best';

function detectQuality() {
  const params = new URLSearchParams(location.search);
  if (params.get('quality') in QUALITY) return params.get('quality');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const weak = (navigator.hardwareConcurrency || 8) <= 4;
  return coarse || weak ? 'low' : 'high';
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function readBest() {
  try {
    const v = parseFloat(localStorage.getItem(BEST_KEY));
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function writeBest(v) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* storage unavailable */
  }
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.qualityName = detectQuality();
    this.quality = QUALITY[this.qualityName];
    this.state = 'menu'; // menu | playing | paused | won | lost
    this.time = 0;
    this.runTime = 0;
    this.best = readBest();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.qualityName === 'high', powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SKY_HORIZON.clone(), 70, 230);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1000);

    this.sky = createSky();
    this.scene.add(this.sky);
    this._setupLights();

    this.terrain = new Terrain();
    this.scene.add(this.terrain.createMesh());
    this.water = createWater({ terrain: this.terrain, heightTexture: this.terrain.createHeightTexture() });
    this.scene.add(this.water);

    this.physics = new PhysicsWorld(this.terrain);
    this.level = buildLevel({ scene: this.scene, terrain: this.terrain, physics: this.physics });

    this.player = new Player(this.physics);
    this.scene.add(this.player.object);
    this.sentinels = this.level.routes.map((route) => new Sentinel(this.physics, route, { spotLight: this.quality.spotLights }));
    for (const s of this.sentinels) this.scene.add(s.object);
    this.orbs = new Orbs(this.level.orbSpots);
    this.scene.add(this.orbs.mesh, this.orbs.light);
    this.particles = new Particles();
    this.scene.add(this.particles.points);
    this._createBlobShadows();

    this.rig = new ThirdPersonCamera(this.camera, this.physics);
    this.input = new Input(canvas);
    this.sfx = new Sfx();
    this.ui = this._bindUI();

    this._accumulator = 0;
    this._frames = 0;
    this._fpsTime = 0;
    this.fps = 0;
    this.debugVisible = false;
    this.colliderHelpers = null;

    this.applyQuality(this.qualityName);
    this.resetRun();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.pointerLocked && this.state === 'playing' && this._lockedOnce && !this.input.isTouch) this.pause();
      if (this.input.pointerLocked) this._lockedOnce = true;
    });
    this.resize();
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  _setupLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a6b3a, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    this.sun.shadow.camera.left = -SHADOW_EXTENT;
    this.sun.shadow.camera.right = SHADOW_EXTENT;
    this.sun.shadow.camera.top = SHADOW_EXTENT;
    this.sun.shadow.camera.bottom = -SHADOW_EXTENT;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 160;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this._sunBasis = new THREE.Matrix4().lookAt(SUN_DIRECTION, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    this._sunBasisInv = this._sunBasis.clone().invert();
  }

  /**
   * The shadow frustum follows the player (one tight "cascade" instead of
   * shadowing the whole island). Its centre is snapped to shadow-map texels in
   * light space so shadows don't shimmer as you move.
   */
  _updateSun(focus) {
    const texel = (SHADOW_EXTENT * 2) / this.quality.shadowMapSize;
    const p = focus.clone().applyMatrix4(this._sunBasisInv);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(this._sunBasis);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(SUN_DIRECTION, 80);
  }

  /** Blob shadows: the cheap fallback when real-time shadows are off. */
  _createBlobShadows() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.blobs = [this.player, ...this.sentinels].map((owner) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      return { owner, mesh, size: owner === this.player ? 1.3 : 1.6 };
    });
  }

  _updateBlobShadows() {
    for (const b of this.blobs) {
      b.mesh.visible = !this.quality.shadows;
      if (!b.mesh.visible) continue;
      const p = b.owner.position;
      const h = this.terrain.heightAt(p.x, p.z);
      const hit = this.physics.raycast(new THREE.Vector3(p.x, p.y + 0.1, p.z), new THREE.Vector3(0, -1, 0), 20, Layers.STATIC, { terrain: false });
      const ground = hit ? Math.max(hit.point.y, h) : h;
      const fade = clamp(1 - (p.y - ground) / 8, 0.2, 1);
      b.mesh.position.set(p.x, ground + 0.03, p.z);
      b.mesh.scale.setScalar(b.size * fade);
    }
  }

  applyQuality(name) {
    this.qualityName = name;
    this.quality = QUALITY[name];
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    for (const s of this.sentinels) s.setSpotLight(q.spotLights);
    this.level.forest.distanceScale = q.lodScale;
    this.scene.fog.far = 230 * (0.75 + 0.25 * q.lodScale);
    // Shadow/light changes alter shader permutations: recompile once now.
    this.scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
    });
    this.resize();
    if (this.ui) this.ui.quality.textContent = q.label;
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _bindUI() {
    const $ = (id) => document.getElementById(id);
    const ui = {
      overlay: $('overlay'),
      title: $('overlay-title'),
      text: $('overlay-text'),
      button: $('overlay-button'),
      orbCount: $('orb-count'),
      orbTotal: $('orb-total'),
      health: $('health-fill'),
      timer: $('timer'),
      alert: $('alert'),
      debug: $('debug'),
      quality: $('quality-label'),
      toast: $('toast'),
      hud: $('hud'),
      touch: $('touch-controls'),
    };
    ui.orbTotal.textContent = this.orbs.total;
    ui.button.addEventListener('click', () => this.onPrimaryAction());
    ui.quality.parentElement.addEventListener('click', () => this.applyQuality(this.qualityName === 'high' ? 'low' : 'high'));
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.pointerLocked) this.input.requestPointerLock();
    });
    if (this.input.isTouch) ui.touch.hidden = false;
    return ui;
  }

  onPrimaryAction() {
    this.sfx.unlock();
    if (this.state === 'won' || this.state === 'lost') this.resetRun();
    this.state = 'playing';
    this.ui.overlay.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
    this.input.requestPointerLock();
  }

  pause() {
    this.state = 'paused';
    this._showOverlay('Paused', 'Take a breather.', 'Resume');
  }

  _showOverlay(title, html, button) {
    this.ui.title.textContent = title;
    this.ui.text.innerHTML = html;
    this.ui.button.textContent = button;
    this.ui.overlay.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _toast(text) {
    this.ui.toast.textContent = text;
    this.ui.toast.classList.remove('show');
    void this.ui.toast.offsetWidth;
    this.ui.toast.classList.add('show');
  }

  resetRun() {
    this.player.spawn(this.level.spawn, Math.PI);
    this.orbs.reset();
    for (const s of this.sentinels) s.reset();
    this.runTime = 0;
    this.rig.yaw = 0;
    this.rig.pitch = 0.3;
    this.rig.snapTo(this.player.position);
  }

  frame(timestamp) {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.time += dt;
    this._handleHotkeys();

    const look = this.input.consumeLook();
    if (this.state === 'playing') {
      this.rig.applyLook(look);
      this._accumulator += dt;
      const snapshot = { move: this.input.move(), sprint: this.input.sprint, jump: this.input.consumeJump() };
      let steps = 0;
      while (this._accumulator >= FIXED_STEP && steps < 6 && this.state === 'playing') {
        this.step(FIXED_STEP, snapshot);
        snapshot.jump = false;
        this._accumulator -= FIXED_STEP;
        steps++;
      }
      if (steps === 6) this._accumulator = 0;
      this.runTime += dt;
    } else {
      this.input.consumeJump();
    }

    this._animate(dt);
    this._render(dt);
    this.input.endFrame();
  }

  step(dt, input) {
    const p = this.player;
    p.step(dt, input, this.rig);
    for (const s of this.sentinels) s.step(dt, p, this.time);

    for (const i of this.orbs.check(p)) {
      this.particles.burst(this.orbs.spots[i], 50, 7);
      this.sfx.pickup(this.orbs.count);
      const left = this.orbs.total - this.orbs.count;
      if (left > 0) this._toast(left === 1 ? 'One orb left!' : `${left} orbs left`);
    }

    for (const e of p.events.splice(0)) {
      if (e === 'jump') this.sfx.jump();
      else if (e === 'land') this.sfx.land();
      else if (e === 'splash') {
        this.sfx.splash();
        this._toast('Splash! Back to dry land');
        this.rig.snapTo(p.position);
      }
    }
    for (const s of this.sentinels) {
      for (const e of s.events.splice(0)) {
        if (e === 'alert') this.sfx.alert();
        if (e === 'hit') {
          this.sfx.hurt();
          this.rig.addTrauma(0.7);
          this.particles.burst(p.center, 25, 5);
        }
      }
    }

    if (this.orbs.count === this.orbs.total) this._finish(true);
    else if (p.health <= 0) this._finish(false);
  }

  _finish(won) {
    this.state = won ? 'won' : 'lost';
    if (won) {
      this.sfx.win();
      const record = this.best === null || this.runTime < this.best;
      if (record) {
        this.best = this.runTime;
        writeBest(this.runTime);
      }
      this._showOverlay(
        'All orbs recovered!',
        `Time <b>${formatTime(this.runTime)}</b>${record ? ' — new best!' : ` · best ${formatTime(this.best)}`}`,
        'Play again',
      );
    } else {
      this.sfx.lose();
      this._showOverlay('Knocked out', `You recovered <b>${this.orbs.count}</b> of ${this.orbs.total} orbs.`, 'Try again');
    }
  }

  _handleHotkeys() {
    const i = this.input;
    if (i.wasPressed('KeyQ')) this.applyQuality(this.qualityName === 'high' ? 'low' : 'high');
    if (i.wasPressed('F3') || i.wasPressed('Backquote')) {
      this.debugVisible = !this.debugVisible;
      this.ui.debug.hidden = !this.debugVisible;
    }
    if (i.wasPressed('KeyH')) this._toggleColliders();
    if (i.wasPressed('KeyM')) this._toast(this.sfx.toggleMute() ? 'Sound off' : 'Sound on');
    if (i.wasPressed('KeyP') && this.state === 'playing') this.pause();
  }

  /** Visualise the simple collision shapes hiding behind the detailed visuals. */
  _toggleColliders() {
    if (!this.colliderHelpers) {
      const group = new THREE.Group();
      const boxMat = new THREE.LineBasicMaterial({ color: 0x00ff88 });
      const treeMat = new THREE.LineBasicMaterial({ color: 0xffee55 });
      const sphereGeo = new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 10, 6));
      const boxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
      for (const c of this.physics.colliders) {
        const mat = c.layer & Layers.TREE ? treeMat : boxMat;
        const line = new THREE.LineSegments(c.type === 'box' ? boxGeo : sphereGeo, mat);
        if (c.type === 'box') {
          line.position.addVectors(c.min, c.max).multiplyScalar(0.5);
          line.scale.subVectors(c.max, c.min);
        } else {
          line.position.copy(c.center);
          line.scale.setScalar(c.radius);
        }
        group.add(line);
      }
      this.colliderHelpers = group;
      this.scene.add(group);
      this._toast(`${this.physics.colliders.length} colliders (H to hide)`);
      return;
    }
    this.colliderHelpers.visible = !this.colliderHelpers.visible;
  }

  _animate(dt) {
    const p = this.player;
    p.animate(dt, this.time);
    for (const s of this.sentinels) s.animate(dt, this.time);
    this.orbs.update(dt, this.time, p.position);
    this.particles.update(dt);
    updateLevelLights(this.level.lights, this.time);
    this.water.material.uniforms.uTime.value = this.time;

    if (this.state === 'menu') {
      // Attract mode: slow orbit over the island.
      const a = this.time * 0.06;
      this.camera.position.set(Math.sin(a) * 70, 34, Math.cos(a) * 70);
      this.camera.lookAt(0, 4, 0);
    } else {
      const speed01 = clamp((p.horizontalSpeed - PLAYER.walkSpeed) / (PLAYER.sprintSpeed - PLAYER.walkSpeed), 0, 1);
      this.rig.update(dt, p.position, p.velocity, speed01);
    }
    this.sky.position.copy(this.camera.position);
    this._updateSun(this.state === 'menu' ? new THREE.Vector3() : p.position);
    this._updateBlobShadows();

    // HUD
    this.ui.orbCount.textContent = this.orbs.count;
    this.ui.health.style.width = `${p.health}%`;
    this.ui.health.classList.toggle('low', p.health <= 40);
    this.ui.timer.textContent = formatTime(this.runTime);
    const chased = this.state === 'playing' && this.sentinels.some((s) => s.state === 'chase' || s.state === 'alert');
    this.ui.alert.classList.toggle('show', chased);
  }

  _render(dt) {
    this.camera.updateMatrixWorld();
    this.level.forest.update(this.camera);
    this.renderer.render(this.scene, this.camera);

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
    const f = this.level.forest.stats;
    const states = this.sentinels.map((s) => s.state[0].toUpperCase()).join('');
    this.ui.debug.textContent = [
      `FPS        ${this.fps}`,
      `Draw calls ${info.calls}`,
      `Triangles  ${info.triangles.toLocaleString()}`,
      `Quality    ${this.quality.label} (Q)`,
      `Trees      ${f.total}: near ${f.levels[0]} / mid ${f.levels[1]} / far ${f.levels[2]} / culled ${f.culled}`,
      `Colliders  ${this.physics.colliders.length} (H)`,
      `Sentinels  ${states}`,
      `Player     ${this.player.position.toArray().map((v) => v.toFixed(1)).join(', ')}${this.player.grounded ? ' grounded' : ''}`,
    ].join('\n');
  }
}
