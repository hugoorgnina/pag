/**
 * Keyboard + mouse (pointer lock or drag) + touch (virtual stick, look pad,
 * jump/sprint buttons), unified into one small polled interface.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.look = { x: 0, y: 0 };
    this.zoom = 0;
    this.stick = { x: 0, y: 0, active: false };
    this.touchSprint = false;
    this._jumpQueued = false;
    this._pressed = new Set();
    this.dragging = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this._pressed.add(e.code);
      if (e.code === 'Space') this._jumpQueued = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousedown', () => {
      this.dragging = true;
    });
    addEventListener('mouseup', () => {
      this.dragging = false;
    });
    // Browsers often report one huge bogus delta right after pointer lock engages.
    this._skipMoves = 0;
    document.addEventListener('pointerlockchange', () => {
      this._skipMoves = 2;
    });
    addEventListener('mousemove', (e) => {
      if (this._skipMoves > 0) {
        this._skipMoves--;
        return;
      }
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      if (document.pointerLockElement === canvas || this.dragging) {
        this.look.x += e.movementX;
        this.look.y += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => {
      this.zoom += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    this._setupTouch();
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  requestPointerLock() {
    if (this.isTouch || !this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* drag-to-look still works */
    }
  }

  /** Movement intent in [-1, 1]²: x = strafe right, y = forward. */
  move() {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.stick.active) {
      x += this.stick.x;
      y += this.stick.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  get sprint() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprint;
  }

  consumeJump() {
    const j = this._jumpQueued;
    this._jumpQueued = false;
    return j;
  }

  consumeLook() {
    const l = { x: this.look.x, y: this.look.y, zoom: this.zoom };
    this.look.x = this.look.y = this.zoom = 0;
    return l;
  }

  /** True once per key press. */
  wasPressed(code) {
    const had = this._pressed.has(code);
    this._pressed.delete(code);
    return had;
  }

  endFrame() {
    this._pressed.clear();
  }

  _setupTouch() {
    const stickEl = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    const lookPad = document.getElementById('look-pad');
    const jumpBtn = document.getElementById('btn-jump');
    const sprintBtn = document.getElementById('btn-sprint');
    if (!stickEl || !lookPad) return;

    let stickId = null;
    let origin = null;
    const radius = 50;
    stickEl.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId;
      const r = stickEl.getBoundingClientRect();
      origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      stickEl.setPointerCapture(e.pointerId);
      this.stick.active = true;
      update(e);
    });
    const update = (e) => {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - origin.x;
      let dy = e.clientY - origin.y;
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stick.x = dx / radius;
      this.stick.y = -dy / radius;
    };
    const release = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      this.stick.active = false;
      this.stick.x = this.stick.y = 0;
      knob.style.transform = '';
    };
    stickEl.addEventListener('pointermove', update);
    stickEl.addEventListener('pointerup', release);
    stickEl.addEventListener('pointercancel', release);

    let lookId = null;
    let last = null;
    lookPad.addEventListener('pointerdown', (e) => {
      lookId = e.pointerId;
      last = { x: e.clientX, y: e.clientY };
      lookPad.setPointerCapture(e.pointerId);
    });
    lookPad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      this.look.x += (e.clientX - last.x) * 1.6;
      this.look.y += (e.clientY - last.y) * 1.6;
      last = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e) => {
      if (e.pointerId === lookId) lookId = null;
    };
    lookPad.addEventListener('pointerup', endLook);
    lookPad.addEventListener('pointercancel', endLook);

    jumpBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._jumpQueued = true;
    });
    sprintBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.touchSprint = !this.touchSprint;
      sprintBtn.classList.toggle('on', this.touchSprint);
    });
  }
}
