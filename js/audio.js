// The Khora ambience under the city and every world, plus a chime when a fragment opens.
const AMBIENCE = 'audio/khora-ambience.mp3';

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = false;
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
      // The recording plays straight to the master (no added reverb), looping; it is only
      // fetched once someone turns the sound on.
      this.track = Object.assign(new Audio(AMBIENCE), { loop: true, preload: 'auto' });
      this.ctx.createMediaElementSource(this.track).connect(this.master);
    }
    this.ctx.resume();
    this.enabled = true;
    this.track.play().catch(() => {});
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0.5, this.ctx.currentTime, 1.2);
  }

  disable() {
    this.enabled = false;
    if (!this.ctx) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    // Paused once faded, so a muted tab is not still decoding the track.
    clearTimeout(this.pausing);
    this.pausing = setTimeout(() => { if (!this.enabled) this.track.pause(); }, 2000);
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

  // The ambience is the same everywhere; a world only tunes its chimes (null: the city).
  setWorld(world) {
    this.world = world;
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
