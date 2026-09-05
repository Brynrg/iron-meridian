// Procedural jukebox. Three original tracks generated from seeded patterns
// with Web Audio: a driving march, a tense low drone, and a cold synth theme.
// No samples, nothing to license. Runs on the audio clock so it never drifts.

interface Track {
  id: string;
  name: string;
  bpm: number;
  root: number; // MIDI note
  scale: number[]; // semitone offsets
  bassPattern: number[]; // scale degrees per 8th (-1 = rest)
  leadPattern: number[];
  drums: string; // 16 steps: k=kick s=snare h=hat . =rest
  leadWave: OscillatorType;
  bassWave: OscillatorType;
}

export const TRACKS: Track[] = [
  {
    id: "march",
    name: "Iron March",
    bpm: 128,
    root: 40,
    scale: [0, 2, 3, 5, 7, 8, 10],
    bassPattern: [0, 0, 0, 0, 4, 4, 3, 3, 0, 0, 0, 0, 5, 5, 4, 4],
    leadPattern: [7, -1, 9, 7, 10, -1, 9, 7, 5, -1, 7, 5, 3, -1, 2, 0],
    drums: "k.hsk.h.k.hsk.hh",
    leadWave: "square",
    bassWave: "sawtooth",
  },
  {
    id: "drone",
    name: "Cold Front",
    bpm: 84,
    root: 36,
    scale: [0, 1, 3, 5, 7, 8, 10],
    bassPattern: [0, -1, -1, -1, 0, -1, -1, -1, 3, -1, -1, -1, 2, -1, -1, -1],
    leadPattern: [-1, -1, 7, -1, -1, -1, 8, -1, -1, -1, 7, -1, -1, 5, -1, -1],
    drums: "k...h...k..k.h..",
    leadWave: "triangle",
    bassWave: "sine",
  },
  {
    id: "synth",
    name: "Meridian Line",
    bpm: 112,
    root: 43,
    scale: [0, 2, 4, 5, 7, 9, 11],
    bassPattern: [0, 0, 7, 0, 5, 5, 7, 5, 3, 3, 7, 3, 4, 4, 7, 4],
    leadPattern: [4, 6, 7, 6, 4, 2, 4, -1, 2, 4, 6, 4, 2, 0, 2, -1],
    drums: "k.h.s.h.k.h.s.hh",
    leadWave: "sawtooth",
    bassWave: "square",
  },
];

export class Music {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private timer = 0;
  private nextStepTime = 0;
  private step = 0;
  private bar = 0;
  track: Track = TRACKS[0] as Track;
  playing = false;
  volume = 0.25;
  shuffle = true;

  attach(ctx: AudioContext, dest: AudioNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(dest);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  play(id?: string): void {
    if (!this.ctx) return;
    if (id) this.track = TRACKS.find((t) => t.id === id) ?? this.track;
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.bar = 0;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  stop(): void {
    this.playing = false;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  next(): void {
    const i = TRACKS.indexOf(this.track);
    this.track = TRACKS[(i + 1) % TRACKS.length] as Track;
    this.step = 0;
    this.bar = 0;
  }

  private schedule(): void {
    if (!this.ctx || !this.gain) return;
    const stepDur = 60 / this.track.bpm / 4; // 16th notes
    while (this.nextStepTime < this.ctx.currentTime + 0.25) {
      this.playStep(this.step, this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) {
        this.bar++;
        if (this.shuffle && this.bar % 32 === 0) this.next();
      }
    }
  }

  private note(deg: number, octave: number): number {
    const t = this.track;
    const idx = ((deg % t.scale.length) + t.scale.length) % t.scale.length;
    const oct = Math.floor(deg / t.scale.length) + octave;
    return t.root + (t.scale[idx] as number) + oct * 12;
  }

  private playStep(step: number, time: number, dur: number): void {
    const c = this.ctx;
    const out = this.gain;
    if (!c || !out) return;
    const t = this.track;
    // Drums
    const d = t.drums[step] ?? ".";
    if (d === "k") this.kick(time);
    else if (d === "s") this.snare(time);
    else if (d === "h") this.hat(time);
    // Bass on 8ths, with a variation every other 4 bars.
    if (step % 2 === 0) {
      const deg = t.bassPattern[step] as number;
      if (deg >= 0) this.tone(this.note(deg + (this.bar % 8 >= 4 ? 2 : 0), 0), time, dur * 1.8, 0.16, t.bassWave, 400);
    }
    // Lead every 16th, dropping out for 4 bars in 16 to breathe.
    if (this.bar % 16 < 12) {
      const deg = t.leadPattern[step] as number;
      if (deg >= 0) {
        const swing = this.bar % 2 ? 1 : 0;
        this.tone(this.note(deg + swing * 0, 2), time, dur * 0.9, 0.06, t.leadWave, 2200);
        if (this.bar % 4 === 3) this.tone(this.note(deg + 2, 2), time, dur * 0.9, 0.03, t.leadWave, 2200);
      }
    }
    // Pad chord on bar starts.
    if (step === 0) {
      const root = this.bar % 8 >= 4 ? 5 : 0;
      for (const deg of [root, root + 2, root + 4]) this.tone(this.note(deg, 1), time, dur * 16, 0.025, "triangle", 900);
    }
  }

  private tone(midi: number, time: number, dur: number, gain: number, type: OscillatorType, cutoff: number): void {
    const c = this.ctx as AudioContext;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.gain as GainNode);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  private kick(time: number): void {
    const c = this.ctx as AudioContext;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, time);
    o.frequency.exponentialRampToValueAtTime(40, time + 0.15);
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
    o.connect(g);
    g.connect(this.gain as GainNode);
    o.start(time);
    o.stop(time + 0.3);
  }

  private snare(time: number): void {
    const c = this.ctx as AudioContext;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * 0.12), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.25, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    s.connect(f);
    f.connect(g);
    g.connect(this.gain as GainNode);
    s.start(time);
  }

  private hat(time: number): void {
    const c = this.ctx as AudioContext;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * 0.03), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.08, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    s.connect(f);
    f.connect(g);
    g.connect(this.gain as GainNode);
    s.start(time);
  }
}
