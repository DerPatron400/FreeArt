// A quiet generative drone per world, plus a chime when a fragment opens.
const MOODS = {
  warm: [1, 1.5, 2, 3],
  bright: [1, 1.5, 2.25, 3, 4],
  dark: [1, 1.2, 1.5, 2],
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.voices = [];
    this.world = null;
  }

  enable() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this.impulse(4.5);
      const wet = this.ctx.createGain();
      wet.gain.value = 0.6;
      this.bus = this.ctx.createGain();
      this.bus.connect(this.master);
      this.bus.connect(this.reverb);
      this.reverb.connect(wet).connect(this.master);
      this.master.connect(this.ctx.destination);
    }
    this.ctx.resume();
    this.enabled = true;
    this.master.gain.setTargetAtTime(0.5, this.ctx.currentTime, 1.2);
    this.setWorld(this.world, true);
  }

  disable() {
    this.enabled = false;
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
  }

  toggle() {
    if (this.enabled) this.disable(); else this.enable();
    return this.enabled;
  }

  impulse(seconds) {
    const rate = this.ctx.sampleRate, len = rate * seconds;
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  // world === null plays the city: a low open fifth.
  setWorld(world, force = false) {
    const key = world ? `${world.sound.root}:${world.sound.mood}` : 'city';
    if (!force && key === this.key) { this.world = world; return; }
    this.world = world;
    this.key = key;
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.9);
      v.oscs.forEach((o) => o.stop(now + 5));
    }
    const root = world ? world.sound.root : 55;
    const ratios = world ? MOODS[world.sound.mood] : [1, 1.5, 2];
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = root * 6;
    filter.Q.value = 0.7;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.05 + Math.random() * 0.05;
    lfoGain.gain.value = root * 3;
    lfo.connect(lfoGain).connect(filter.frequency);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain).connect(this.bus);
    const oscs = [lfo];
    ratios.forEach((r, i) => {
      for (const detune of [-5, 6]) {
        const o = this.ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = root * r;
        o.detune.value = detune + (Math.random() - 0.5) * 4;
        const g = this.ctx.createGain();
        g.gain.value = 0.11 / (i + 1);
        o.connect(g).connect(filter);
        oscs.push(o);
      }
    });
    oscs.forEach((o) => o.start(now));
    gain.gain.setTargetAtTime(1, now + 0.3, 1.8);
    this.voices = [{ gain, oscs }];
  }

  chime(i = 0) {
    if (!this.enabled || !this.ctx) return;
    const root = this.world ? this.world.sound.root : 110;
    const harm = [4, 5, 6, 8, 9, 10, 12][i % 7];
    const now = this.ctx.currentTime;
    for (const [mult, amp] of [[1, 0.12], [2.01, 0.03]]) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = root * harm * mult;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 3.5);
      o.connect(g).connect(this.bus);
      o.start(now);
      o.stop(now + 3.6);
    }
  }
}
