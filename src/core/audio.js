/** Tiny WebAudio synth for feedback sounds — no asset files needed. */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.25;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.25;
    return this.muted;
  }

  tone(freq, dur = 0.15, { type = 'sine', vol = 0.5, slide = 0, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  pickup(n) {
    const base = 520 * Math.pow(2, (n % 8) / 12);
    this.tone(base, 0.12, { type: 'triangle', vol: 0.45 });
    this.tone(base * 1.5, 0.2, { type: 'triangle', vol: 0.35, delay: 0.07 });
  }
  jump() { this.tone(300, 0.12, { type: 'square', vol: 0.12, slide: 250 }); }
  land() { this.tone(120, 0.08, { type: 'sine', vol: 0.3, slide: -60 }); }
  hurt() { this.tone(180, 0.3, { type: 'sawtooth', vol: 0.35, slide: -120 }); }
  splash() { this.tone(600, 0.35, { type: 'sine', vol: 0.3, slide: -500 }); }
  alert() {
    this.tone(880, 0.09, { type: 'square', vol: 0.15 });
    this.tone(1175, 0.12, { type: 'square', vol: 0.15, delay: 0.1 });
  }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', vol: 0.4, delay: i * 0.12 }));
  }
  lose() {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, { type: 'sawtooth', vol: 0.2, delay: i * 0.18 }));
  }
}
