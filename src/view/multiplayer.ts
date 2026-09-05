// Peer-to-peer lockstep multiplayer over WebRTC data channels with manual
// (copy/paste) signalling, so it needs no server at all and stays inside the
// portal's static-only rules. Both peers run the identical deterministic sim;
// each tick's commands are exchanged ahead of time and applied on the same
// tick number. Hashes are compared every second to catch desyncs.
//
// Flow: host creates an offer code -> guest pastes it and produces an answer
// code -> host pastes the answer. Then both sides pick a seed/map and start.

import type { Command } from "../sim/types";

export const INPUT_DELAY_TICKS = 4;

export interface NetMessage {
  t: "cmds" | "hash" | "start" | "hello" | "chat" | "quit";
  tick?: number;
  cmds?: Command[];
  hash?: number;
  seed?: number;
  mapId?: string;
  hostFaction?: string;
  guestFaction?: string;
  hostName?: string;
  guestName?: string;
  text?: string;
}

export class PeerLink {
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null = null;
  onMessage: ((m: NetMessage) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  isHost = false;

  constructor() {
    this.pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    this.pc.ondatachannel = (e) => this.attach(e.channel);
  }

  private attach(ch: RTCDataChannel): void {
    this.channel = ch;
    ch.onopen = () => this.onOpen?.();
    ch.onclose = () => this.onClose?.();
    ch.onmessage = (e) => {
      try {
        this.onMessage?.(JSON.parse(e.data as string) as NetMessage);
      } catch {
        // ignore malformed
      }
    };
  }

  /** Host: create an offer and return it as a compact code once ICE gathering completes. */
  async createOffer(): Promise<string> {
    this.isHost = true;
    this.attach(this.pc.createDataChannel("sim", { ordered: true }));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.waitIce();
    return encode(this.pc.localDescription as RTCSessionDescription);
  }

  /** Guest: accept an offer code and return an answer code. */
  async acceptOffer(code: string): Promise<string> {
    this.isHost = false;
    await this.pc.setRemoteDescription(decode(code));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.waitIce();
    return encode(this.pc.localDescription as RTCSessionDescription);
  }

  /** Host: finish with the guest's answer code. */
  async acceptAnswer(code: string): Promise<void> {
    await this.pc.setRemoteDescription(decode(code));
  }

  send(m: NetMessage): void {
    if (this.channel && this.channel.readyState === "open") this.channel.send(JSON.stringify(m));
  }

  close(): void {
    try {
      this.channel?.close();
      this.pc.close();
    } catch {
      // ignore
    }
  }

  private waitIce(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === "complete") return resolve();
      const check = () => {
        if (this.pc.iceGatheringState === "complete") {
          this.pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };
      this.pc.addEventListener("icegatheringstatechange", check);
      setTimeout(resolve, 4000); // do not hang forever on slow candidate gathering
    });
  }
}

function encode(desc: RTCSessionDescription): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify({ type: desc.type, sdp: desc.sdp }))));
}

function decode(code: string): RTCSessionDescriptionInit {
  return JSON.parse(decodeURIComponent(escape(atob(code.trim())))) as RTCSessionDescriptionInit;
}

/**
 * Lockstep scheduler. Local commands issued at tick T are scheduled for
 * T + INPUT_DELAY_TICKS and sent to the peer; the sim may only advance to a
 * tick once both sides' command sets for it are known.
 */
export class Lockstep {
  link: PeerLink;
  localPlayer: number;
  remotePlayer: number;
  scheduled = new Map<number, { local: Command[] | null; remote: Command[] | null }>();
  remoteHashes = new Map<number, number>();
  desync = false;
  peerQuit = false;

  constructor(link: PeerLink, localPlayer: number) {
    this.link = link;
    this.localPlayer = localPlayer;
    this.remotePlayer = 1 - localPlayer;
    link.onMessage = (m) => this.receive(m);
    // Pre-seed the first delay ticks with empty command sets on both sides.
    for (let t = 0; t < INPUT_DELAY_TICKS; t++) this.scheduled.set(t, { local: [], remote: [] });
  }

  private slot(tick: number): { local: Command[] | null; remote: Command[] | null } {
    let s = this.scheduled.get(tick);
    if (!s) {
      s = { local: null, remote: null };
      this.scheduled.set(tick, s);
    }
    return s;
  }

  private lastSubmitted = -1;
  private deferred: Command[] = [];

  /**
   * Called before each attempt to step a tick. Commands are scheduled for a
   * future tick exactly once per tick; while a tick is stalled waiting for the
   * peer, new local commands are deferred to the next submission so both
   * peers always agree on the command set of every tick.
   */
  submitLocal(currentTick: number, cmds: Command[]): void {
    if (this.lastSubmitted === currentTick) {
      this.deferred.push(...cmds);
      return;
    }
    this.lastSubmitted = currentTick;
    const all = [...this.deferred, ...cmds];
    this.deferred = [];
    const target = currentTick + INPUT_DELAY_TICKS;
    const s = this.slot(target);
    s.local = all;
    this.link.send({ t: "cmds", tick: target, cmds: all });
  }

  /** Commands for `tick` if both sides are known, else null (must wait). */
  commandsFor(tick: number): Command[] | null {
    const s = this.scheduled.get(tick);
    if (!s || s.local === null || s.remote === null) return null;
    const merged = [...s.local, ...s.remote].sort((a, b) => a.player - b.player);
    this.scheduled.delete(tick);
    return merged;
  }

  reportHash(tick: number, hash: number): void {
    this.link.send({ t: "hash", tick, hash });
    const theirs = this.remoteHashes.get(tick);
    if (theirs !== undefined) {
      if (theirs !== hash) this.desync = true;
      this.remoteHashes.delete(tick);
    }
    this.pendingLocalHash.set(tick, hash);
    if (this.pendingLocalHash.size > 40) {
      const oldest = Math.min(...this.pendingLocalHash.keys());
      this.pendingLocalHash.delete(oldest);
    }
  }
  private pendingLocalHash = new Map<number, number>();

  private receive(m: NetMessage): void {
    if (m.t === "cmds" && m.tick !== undefined) {
      const s = this.slot(m.tick);
      s.remote = (m.cmds ?? []).map((c) => ({ ...c, player: this.remotePlayer }));
    } else if (m.t === "hash" && m.tick !== undefined && m.hash !== undefined) {
      const mine = this.pendingLocalHash.get(m.tick);
      if (mine !== undefined) {
        if (mine !== m.hash) this.desync = true;
        this.pendingLocalHash.delete(m.tick);
      } else this.remoteHashes.set(m.tick, m.hash);
    } else if (m.t === "quit") this.peerQuit = true;
    else this.onOther?.(m);
  }
  onOther: ((m: NetMessage) => void) | null = null;
}

// ── Lobby UI ─────────────────────────────────────────────────────────────────

export interface LobbyResult {
  link: PeerLink;
  isHost: boolean;
  seed: number;
  mapId: string;
  hostFaction: "alliance" | "pact";
  guestFaction: "alliance" | "pact";
}

export function showLobby(parent: HTMLElement, mapOptions: Array<{ id: string; name: string }>, onStart: (r: LobbyResult) => void, onBack: () => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "menu";
  root.innerHTML = `
    <div class="menu-card wide">
      <h2>Multiplayer · 1v1 lockstep (peer to peer)</h2>
      <p class="fine" style="margin-top:0">No server is involved. Exchange the two codes with your opponent over any chat. Both games then run in lockstep and compare checksums every second.</p>
      <div class="menu-grid">
        <label>Role <select id="mp-role"><option value="host">Host (create offer)</option><option value="guest">Guest (paste offer)</option></select></label>
        <label>Your faction <select id="mp-fac"><option value="alliance">Meridian Alliance</option><option value="pact">Ural Pact</option></select></label>
        <label>Map (host decides) <select id="mp-map"><option value="random">Random</option>${mapOptions.map((m) => `<option value="${m.id}">${m.name}</option>`).join("")}</select></label>
        <label>Seed (host decides) <input id="mp-seed" type="text" value="${Math.floor(Math.random() * 1e6)}"></label>
      </div>
      <h3 id="mp-step">Step 1 — Host: click "Create offer". Guest: paste the host's offer below.</h3>
      <textarea id="mp-in" rows="4" style="width:100%;background:#0d1015;color:#eee;border:1px solid #3a4452" placeholder="paste code here"></textarea>
      <div class="menu-actions">
        <button id="mp-back">Back</button>
        <button id="mp-create">Create offer</button>
        <button id="mp-accept">Accept pasted code</button>
      </div>
      <h3>Your code (send this to the other player)</h3>
      <textarea id="mp-out" rows="4" readonly style="width:100%;background:#0d1015;color:#9f9;border:1px solid #3a4452"></textarea>
      <div class="menu-actions">
        <button id="mp-copy">Copy code</button>
        <button id="mp-start" class="primary" disabled>Waiting for connection…</button>
      </div>
      <p class="fine" id="mp-status">Not connected.</p>
    </div>`;
  parent.appendChild(root);
  const q = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`) as T;
  const link = new PeerLink();
  const status = (s: string) => (q<HTMLParagraphElement>("mp-status").textContent = s);
  let connected = false;
  let remoteFaction: "alliance" | "pact" = "pact";
  let hostSettings: { seed: number; mapId: string; hostFaction: "alliance" | "pact" } | null = null;

  link.onOpen = () => {
    connected = true;
    status("Connected. Host: press Start when ready.");
    link.send({ t: "hello", hostFaction: q<HTMLSelectElement>("mp-fac").value });
    if (link.isHost) q<HTMLButtonElement>("mp-start").disabled = false;
    q<HTMLButtonElement>("mp-start").textContent = link.isHost ? "Start game" : "Waiting for host…";
  };
  link.onClose = () => status("Connection closed.");
  link.onMessage = (m) => {
    if (m.t === "hello" && m.hostFaction) remoteFaction = m.hostFaction as "alliance" | "pact";
    if (m.t === "start" && !link.isHost && m.seed !== undefined && m.mapId) {
      hostSettings = { seed: m.seed, mapId: m.mapId, hostFaction: (m.hostFaction as "alliance" | "pact") ?? "alliance" };
      onStart({ link, isHost: false, seed: m.seed, mapId: m.mapId, hostFaction: hostSettings.hostFaction, guestFaction: q<HTMLSelectElement>("mp-fac").value as "alliance" | "pact" });
    }
  };

  q<HTMLButtonElement>("mp-back").addEventListener("click", () => {
    link.close();
    onBack();
  });
  q<HTMLButtonElement>("mp-create").addEventListener("click", async () => {
    status("Gathering network candidates…");
    try {
      q<HTMLTextAreaElement>("mp-out").value = await link.createOffer();
      status("Offer ready. Send the code, then paste the guest's answer above and click Accept.");
    } catch (e) {
      status(`Could not create offer: ${String(e)}`);
    }
  });
  q<HTMLButtonElement>("mp-accept").addEventListener("click", async () => {
    const code = q<HTMLTextAreaElement>("mp-in").value.trim();
    if (!code) return;
    try {
      if (q<HTMLSelectElement>("mp-role").value === "guest" && !link.isHost && !connected) {
        status("Creating answer…");
        q<HTMLTextAreaElement>("mp-out").value = await link.acceptOffer(code);
        status("Answer ready. Send it to the host and wait.");
      } else {
        await link.acceptAnswer(code);
        status("Answer accepted. Connecting…");
      }
    } catch (e) {
      status(`Bad code: ${String(e)}`);
    }
  });
  q<HTMLButtonElement>("mp-copy").addEventListener("click", () => {
    const v = q<HTMLTextAreaElement>("mp-out").value;
    if (v) void navigator.clipboard?.writeText(v).catch(() => undefined);
  });
  q<HTMLButtonElement>("mp-start").addEventListener("click", () => {
    if (!connected || !link.isHost) return;
    const seedRaw = q<HTMLInputElement>("mp-seed").value.trim();
    const seed = /^\d+$/.test(seedRaw) ? Number(seedRaw) % 2147483647 : 12345;
    const mapId = q<HTMLSelectElement>("mp-map").value;
    const hostFaction = q<HTMLSelectElement>("mp-fac").value as "alliance" | "pact";
    link.send({ t: "start", seed, mapId, hostFaction });
    onStart({ link, isHost: true, seed, mapId, hostFaction, guestFaction: remoteFaction });
  });
  return root;
}
