// Synthesised sound: Web Audio for effects, SpeechSynthesis (when present)
// for the base-computer voice. No audio files, nothing to license.

const EVA_LINES: Record<string, string> = {
  constructionComplete: "Construction complete.",
  constructionReady: "Structure ready. Select a site.",
  unitReady: "Unit ready.",
  insufficientFunds: "Insufficient funds.",
  lowPower: "Low power.",
  silosNeeded: "Silos needed.",
  baseUnderAttack: "Our base is under attack.",
  harvesterUnderAttack: "Ore truck under attack.",
  structureLost: "Structure lost.",
  harvesterLost: "Ore truck lost.",
  unitLost: "Unit lost.",
  repairing: "Repairing.",
  structureSold: "Structure sold.",
  cancelled: "Cancelled.",
  onHold: "On hold.",
  building: "Building.",
  primaryBuilding: "Primary building set.",
  cannotPlace: "Cannot deploy here.",
  cannotDeploy: "Cannot deploy here.",
  buildingCaptured: "Building captured.",
  buildingInfiltrated: "Building infiltrated.",
  creditsStolen: "Credits stolen.",
  noRefinery: "No refinery available.",
  playerDefeated: "A commander has been eliminated.",
  missionAccomplished: "Mission accomplished.",
  missionFailed: "Mission failed.",
  phaseReady: "Phase Gate charged.",
  aegisReady: "Aegis Field charged.",
  nukeReady: "Atomic warhead armed.",
  nukeLaunched: "Warning: missile launch detected.",
  phaseShift: "Phase shift complete.",
  aegisActive: "Aegis Field active.",
  reconComplete: "Reconnaissance complete.",
  reinforcements: "Reinforcements have arrived.",
  gpsReady: "Satellite ready for launch.",
  gpsActive: "Satellite launched. Map revealed.",
  sonarPulse: "Sonar pulse released.",
  noRearmPad: "Aircraft cannot rearm: no landing pad.",
  reconReady: "Reconnaissance plane ready.",
  paradropReady: "Paratroopers ready.",
  sonarReady: "Sonar pulse ready.",
  objectiveComplete: "Objective complete.",
  newObjective: "New mission objective received.",
  timerStarted: "Mission timer started.",
  autosaved: "Game saved.",
};

const ACKS = ["Yes sir.", "Acknowledged.", "Ready.", "Awaiting orders.", "Reporting."];
const MOVE_ACKS = ["Moving out.", "On my way.", "Affirmative.", "Roger."];
const ATTACK_ACKS = ["Attacking.", "Engaging.", "For the Meridian!", "Target acquired."];

import { Music } from "./music";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  music = new Music();
  private evaBusy = 0;
  private lastEva = new Map<string, number>();
  private lastAck = 0;
  enabled = true;
  voice = true;
  volume = 0.5;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.music.attach(this.ctx, this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  play(name: string, pan = 0): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const out = c.createGain();
    const panner = c.createStereoPanner ? c.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pan;
      out.connect(panner);
      panner.connect(this.master);
    } else out.connect(this.master);
    const noise = (dur: number, gain: number, filterHz: number, type: BiquadFilterType = "lowpass") => {
      const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = filterHz;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(out);
      src.start(t);
    };
    const tone = (freq0: number, freq1: number, dur: number, gain: number, type: OscillatorType = "square") => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + dur);
    };
    switch (name) {
      case "rifle":
      case "mg":
      case "smg":
      case "chaingun":
        noise(0.06, 0.25, 2500, "highpass");
        break;
      case "pistol":
        noise(0.08, 0.3, 1800);
        break;
      case "cannon":
      case "cannon_l":
        noise(0.18, 0.4, 900);
        tone(140, 50, 0.18, 0.3, "triangle");
        break;
      case "cannon_h":
      case "artillery":
        noise(0.3, 0.5, 600);
        tone(100, 35, 0.3, 0.35, "triangle");
        break;
      case "rocket":
      case "v2":
        noise(0.35, 0.25, 1500, "bandpass");
        tone(600, 200, 0.35, 0.1, "sawtooth");
        break;
      case "flame":
        noise(0.4, 0.2, 700, "bandpass");
        break;
      case "zap":
      case "zap_big":
        tone(2200, 300, 0.25, 0.25, "sawtooth");
        noise(0.2, 0.15, 4000, "highpass");
        break;
      case "flak":
        noise(0.1, 0.3, 1200);
        break;
      case "throw":
      case "splash":
      case "torpedo":
        noise(0.15, 0.1, 800);
        break;
      case "heal":
      case "wrench":
        tone(880, 1320, 0.12, 0.08, "sine");
        break;
      case "bite":
        noise(0.08, 0.2, 1500, "bandpass");
        break;
      case "crush":
        noise(0.2, 0.3, 500);
        break;
      case "hit":
        noise(0.08, 0.15, 1000);
        break;
      case "explosion":
        noise(0.5, 0.6, 500);
        tone(90, 30, 0.5, 0.3, "triangle");
        break;
      case "explosion_big":
        noise(1.0, 0.8, 400);
        tone(70, 25, 0.9, 0.4, "triangle");
        break;
      case "nuke":
      case "nuke_small":
      case "c4":
      case "bomb":
        noise(2.0, 1.0, 300);
        tone(60, 20, 1.8, 0.5, "triangle");
        break;
      case "click":
        tone(1200, 900, 0.04, 0.1, "square");
        break;
      case "error":
        tone(300, 200, 0.15, 0.12, "square");
        break;
      case "ready":
        tone(660, 990, 0.1, 0.1, "square");
        break;
      default:
        noise(0.05, 0.1, 2000);
    }
  }

  eva(cue: string): string | null {
    if (!this.enabled) return null;
    const now = performance.now();
    const last = this.lastEva.get(cue) ?? -1e9;
    if (now - last < 4000) return null;
    this.lastEva.set(cue, now);
    const line = EVA_LINES[cue] ?? cue;
    this.speak(line, 0.9, 1.0);
    if (cue === "insufficientFunds" || cue === "cannotPlace" || cue === "cannotDeploy") this.play("error");
    if (cue === "unitReady" || cue === "constructionComplete" || cue === "constructionReady") this.play("ready");
    return line;
  }

  ack(type: string): void {
    void type;
    this.speakAck(ACKS);
  }
  ackMove(): void {
    this.speakAck(MOVE_ACKS);
  }
  ackAttack(): void {
    this.speakAck(ATTACK_ACKS);
  }

  private speakAck(lines: string[]): void {
    const now = performance.now();
    if (now - this.lastAck < 1500) return;
    this.lastAck = now;
    this.speak(lines[Math.floor(Math.random() * lines.length)] as string, 1.1, 1.15, 0.5);
  }

  private speak(text: string, rate: number, pitch: number, volume = 0.9): void {
    if (!this.voice || typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") return;
    const now = performance.now();
    if (now < this.evaBusy) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      u.pitch = pitch;
      u.volume = Math.min(1, volume * this.volume * 2);
      const voices = speechSynthesis.getVoices();
      const pick = voices.find((v) => /en[-_]/i.test(v.lang) && /female|samantha|karen|victoria|zira|google uk english female/i.test(v.name)) ?? voices.find((v) => /en[-_]/i.test(v.lang));
      if (pick) u.voice = pick;
      speechSynthesis.speak(u);
      this.evaBusy = now + 250 + text.length * 55;
    } catch {
      // ignore
    }
  }
}
