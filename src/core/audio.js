/**
 * Tiny WebAudio synth: sound effects and a chiptune sequencer. Every note is
 * generated at runtime, so the game ships without audio files. All melodies
 * are original compositions.
 */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.music = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.28;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.35;
      this.musicBus.connect(this.master);
      this.music = new Music(this);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.28;
    return this.muted;
  }

  tone(freq, dur = 0.15, { type = 'sine', vol = 0.5, slide = 0, delay = 0, bus = null } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(bus || this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur = 0.2, vol = 0.3, { delay = 0, freq = 800 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
  }

  play(name, arg) {
    const f = SOUNDS[name];
    if (f) f(this, arg);
  }
}

const SOUNDS = {
  jump: (s) => s.tone(330, 0.12, { type: 'square', vol: 0.1, slide: 260 }),
  jump3: (s) => {
    s.tone(330, 0.1, { type: 'square', vol: 0.1, slide: 200 });
    s.tone(520, 0.2, { type: 'square', vol: 0.1, slide: 400, delay: 0.08 });
  },
  flip: (s) => s.tone(260, 0.25, { type: 'square', vol: 0.1, slide: 500 }),
  longjump: (s) => s.tone(200, 0.3, { type: 'triangle', vol: 0.3, slide: 300 }),
  wallkick: (s) => {
    s.noise(0.06, 0.25, { freq: 2000 });
    s.tone(440, 0.15, { type: 'square', vol: 0.1, slide: 300 });
  },
  land: (s) => s.noise(0.06, 0.15, { freq: 500 }),
  punch: (s) => s.noise(0.07, 0.25, { freq: 1500 }),
  kick: (s) => s.noise(0.09, 0.3, { freq: 1200 }),
  dive: (s) => s.tone(300, 0.2, { type: 'triangle', vol: 0.25, slide: -120 }),
  spin: (s) => s.tone(600, 0.25, { type: 'triangle', vol: 0.2, slide: 600 }),
  pound: (s) => {
    s.noise(0.25, 0.5, { freq: 300 });
    s.tone(90, 0.25, { type: 'sine', vol: 0.5, slide: -50 });
  },
  boing: (s) => s.tone(200, 0.35, { type: 'sine', vol: 0.4, slide: 700 }),
  bonk: (s) => s.tone(160, 0.15, { type: 'square', vol: 0.15, slide: -80 }),
  skid: (s) => s.noise(0.2, 0.15, { freq: 3000 }),
  hurt: (s) => s.tone(300, 0.35, { type: 'sawtooth', vol: 0.3, slide: -220 }),
  burn: (s) => {
    s.tone(700, 0.4, { type: 'sawtooth', vol: 0.25, slide: -500 });
    s.noise(0.4, 0.2, { freq: 900 });
  },
  hardland: (s) => s.noise(0.3, 0.4, { freq: 250 }),
  splash: (s) => {
    s.noise(0.35, 0.3, { freq: 1500 });
    s.tone(600, 0.35, { type: 'sine', vol: 0.2, slide: -450 });
  },
  coin: (s) => {
    s.tone(988, 0.07, { type: 'square', vol: 0.1 });
    s.tone(1319, 0.25, { type: 'square', vol: 0.1, delay: 0.07 });
  },
  red: (s, n = 1) => {
    const base = 440 * Math.pow(2, (n * 2) / 12);
    s.tone(base, 0.12, { type: 'triangle', vol: 0.4 });
    s.tone(base * 1.5, 0.3, { type: 'triangle', vol: 0.35, delay: 0.1 });
  },
  stomp: (s) => {
    s.tone(500, 0.08, { type: 'square', vol: 0.15, slide: -300 });
    s.noise(0.08, 0.2, { freq: 900 });
  },
  alert: (s) => {
    s.tone(880, 0.08, { type: 'square', vol: 0.1 });
    s.tone(1175, 0.1, { type: 'square', vol: 0.1, delay: 0.09 });
  },
  reveal: (s) => [523, 659, 784, 1047, 1319].forEach((f, i) => s.tone(f, 0.25, { type: 'triangle', vol: 0.3, delay: i * 0.07 })),
  star: (s) => [523, 523, 523, 698, 880, 1047].forEach((f, i) => s.tone(f, i === 5 ? 0.8 : 0.18, { type: 'square', vol: 0.14, delay: [0, 0.15, 0.3, 0.45, 0.62, 0.8][i] })),
  oneup: (s) => [659, 784, 1319, 1047, 1175, 1568].forEach((f, i) => s.tone(f, 0.12, { type: 'square', vol: 0.1, delay: i * 0.09 })),
  die: (s) => [494, 466, 440, 392, 330, 262].forEach((f, i) => s.tone(f, 0.25, { type: 'square', vol: 0.12, delay: i * 0.16 })),
  boss: (s) => [196, 185, 175, 165].forEach((f, i) => s.tone(f, 0.3, { type: 'sawtooth', vol: 0.2, delay: i * 0.2 })),
  bosshit: (s) => {
    s.noise(0.3, 0.5, { freq: 400 });
    s.tone(220, 0.4, { type: 'square', vol: 0.2, slide: -150 });
  },
  portal: (s) => s.tone(300, 0.6, { type: 'sine', vol: 0.3, slide: 900 }),
  locked: (s) => s.tone(150, 0.25, { type: 'square', vol: 0.12 }),
  pause: (s) => s.tone(784, 0.1, { type: 'square', vol: 0.1 }),
};

const _ = null;
/** Original tunes: [lead, bass] 8th-note steps, MIDI numbers. */
export const TUNES = {
  hub: {
    bpm: 128,
    lead: [72, _, 76, 79, 77, _, 76, 74, 72, _, 74, 76, 74, _, _, _, 72, _, 76, 79, 81, _, 79, 77, 76, 74, 72, 74, 72, _, _, _],
    bass: [48, _, 55, _, 53, _, 55, _, 48, _, 55, _, 50, _, 55, _, 48, _, 55, _, 53, _, 57, _, 55, _, 55, _, 48, _, _, _],
  },
  brisa: {
    bpm: 140,
    lead: [65, 69, 72, _, 74, 72, 69, _, 67, 70, 74, _, 72, _, 70, 69, 65, 69, 72, _, 77, 76, 74, 72, 70, 69, 67, 69, 65, _, _, _],
    bass: [41, _, 48, _, 41, _, 48, _, 43, _, 50, _, 43, _, 50, _, 41, _, 48, _, 46, _, 53, _, 48, _, 48, _, 41, _, _, _],
  },
  fortaleza: {
    bpm: 120,
    lead: [62, _, 65, 69, _, 67, 65, _, 64, _, 67, 70, _, 69, 67, _, 62, 65, 69, 74, 72, 70, 69, 67, 65, _, 64, _, 62, _, _, _],
    bass: [38, _, 45, _, 38, _, 45, _, 36, _, 43, _, 36, _, 43, _, 34, _, 41, _, 36, _, 43, _, 37, _, 45, _, 38, _, _, _],
  },
  caldera: {
    bpm: 150,
    lead: [64, _, 65, _, 64, 67, _, 65, 64, _, 62, _, 60, _, 62, _, 64, _, 65, _, 67, 69, _, 67, 65, 64, 62, 60, 64, _, _, _],
    bass: [40, 40, _, 40, 41, _, 40, _, 40, 40, _, 40, 38, _, 36, _, 40, 40, _, 40, 41, _, 43, _, 41, _, 40, _, 40, _, _, _],
  },
  boss: {
    bpm: 170,
    lead: [69, 72, 69, 68, 69, 72, 76, _, 74, 72, 71, 72, 69, _, _, _, 69, 72, 69, 68, 69, 72, 77, _, 76, 74, 72, 71, 69, _, _, _],
    bass: [45, 45, 52, 45, 45, 45, 52, 45, 41, 41, 48, 41, 40, 40, 47, 40, 45, 45, 52, 45, 45, 45, 52, 45, 41, 41, 48, 41, 40, 40, 47, 40],
  },
};

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.tune = null;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
  }

  play(name) {
    const tune = TUNES[name];
    if (!tune || this.tune === tune) return;
    this.tune = tune;
    this.step = 0;
    this.nextTime = this.sfx.ctx.currentTime + 0.1;
    if (!this.timer) this.timer = setInterval(() => this._schedule(), 50);
  }

  stop() {
    this.tune = null;
    clearInterval(this.timer);
    this.timer = null;
  }

  _schedule() {
    const ctx = this.sfx.ctx;
    if (!this.tune || !ctx) return;
    const stepDur = 60 / this.tune.bpm / 2;
    while (this.nextTime < ctx.currentTime + 0.2) {
      const i = this.step % this.tune.lead.length;
      const delay = Math.max(0, this.nextTime - ctx.currentTime);
      const lead = this.tune.lead[i];
      const bass = this.tune.bass[i];
      const bus = this.sfx.musicBus;
      if (lead !== null) this.sfx.tone(mtof(lead), stepDur * 1.6, { type: 'square', vol: 0.12, delay, bus });
      if (bass !== null) this.sfx.tone(mtof(bass), stepDur * 1.8, { type: 'triangle', vol: 0.35, delay, bus });
      if (i % 4 === 2) this.sfx.noise(0.04, 0.06, { delay, freq: 6000 });
      this.nextTime += stepDur;
      this.step++;
    }
  }
}
