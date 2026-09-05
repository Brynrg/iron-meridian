// Code-drawn sprites. Everything is original vector art rendered at runtime,
// so there are no asset files to license. Each drawer works in a local frame
// where (0,0) is the actor centre and one cell is CELL_PX pixels.

import { CELL_PX, facingToRadians } from "../sim/coords";

export interface UnitStyle {
  team: string;
  dark: string;
  light: string;
}

export function teamStyle(color: string): UnitStyle {
  return { team: color, dark: shade(color, -0.35), light: shade(color, 0.3) };
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  r = f(r);
  g = f(g);
  b = f(b);
  return `rgb(${r},${g},${b})`;
}

type Ctx = CanvasRenderingContext2D;

// ── Infantry ────────────────────────────────────────────────────────────────

export function drawInfantry(ctx: Ctx, type: string, facing: number, st: UnitStyle, prone: boolean, walk: number): void {
  ctx.save();
  ctx.rotate(facingToRadians(facing));
  const s = prone ? 0.7 : 1;
  ctx.scale(s, s);
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 2, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Legs (animated)
  ctx.strokeStyle = "#2a2a2a";
  ctx.lineWidth = 2;
  const lw = Math.sin(walk) * 2;
  ctx.beginPath();
  ctx.moveTo(-2, 1);
  ctx.lineTo(-2, 4 + lw);
  ctx.moveTo(2, 1);
  ctx.lineTo(2, 4 - lw);
  ctx.stroke();
  // Body
  ctx.fillStyle = st.team;
  ctx.fillRect(-3.5, -4, 7, 7);
  // Helmet
  ctx.fillStyle = type === "medic" ? "#eee" : type === "engineer" ? "#e8c341" : st.dark;
  ctx.beginPath();
  ctx.arc(0, -3, 3.2, 0, Math.PI * 2);
  ctx.fill();
  // Weapon line
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (type === "rocket") {
    ctx.moveTo(3, -2);
    ctx.lineTo(3, -9);
  } else if (type === "flamer") {
    ctx.moveTo(3, 0);
    ctx.lineTo(4, -7);
  } else if (type === "dog") {
    // dog: small elongated body
    ctx.fillStyle = "#5a3a1a";
    ctx.fillRect(-3, -5, 6, 10);
  } else if (type !== "engineer" && type !== "medic" && type !== "spy" && type !== "thief" && type !== "mechanic") {
    ctx.moveTo(3, 0);
    ctx.lineTo(3.5, -7);
  }
  ctx.stroke();
  if (type === "medic") {
    ctx.fillStyle = "#e33";
    ctx.fillRect(-1, -1, 2, 4);
    ctx.fillRect(-2, 0, 4, 2);
  }
  ctx.restore();
}

// ── Vehicles ────────────────────────────────────────────────────────────────

export function drawVehicle(ctx: Ctx, type: string, facing: number, turretFacing: number, st: UnitStyle, hpFrac: number): void {
  const px = CELL_PX;
  ctx.save();
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(1, 2, px * 0.42, px * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(facingToRadians(facing));
  switch (type) {
    case "oretruck":
      body(ctx, st, 14, 20, 3);
      ctx.fillStyle = "#d9a441";
      ctx.fillRect(-5, -3, 10, 9); // ore hopper
      ctx.fillStyle = st.dark;
      ctx.fillRect(-6, -10, 12, 5); // cab
      break;
    case "mcv":
      body(ctx, st, 16, 22, 3);
      ctx.fillStyle = "#c9c9c9";
      ctx.fillRect(-6, -4, 12, 10);
      ctx.fillStyle = st.dark;
      ctx.fillRect(-7, -10, 14, 5);
      ctx.strokeStyle = "#333";
      ctx.strokeRect(-6, -4, 12, 10);
      break;
    case "ranger":
    case "flaktruck":
    case "jammer":
    case "mobilegap":
    case "rocketlauncher":
    case "demotruck":
      wheeled(ctx, st, type);
      break;
    case "apc":
      body(ctx, st, 14, 18, 4);
      ctx.fillStyle = st.dark;
      ctx.fillRect(-4, -8, 8, 4);
      break;
    case "artillery":
      body(ctx, st, 12, 18, 3);
      ctx.fillStyle = "#444";
      ctx.fillRect(-2, -16, 4, 14);
      break;
    case "minelayer":
      body(ctx, st, 14, 18, 3);
      ctx.fillStyle = "#333";
      ctx.fillRect(-5, 4, 10, 4);
      break;
    case "kolossus":
      tracked(ctx, st, 20, 26);
      break;
    default:
      tracked(ctx, st, type === "lighttank" ? 14 : 16, type === "lighttank" ? 18 : 21);
  }
  ctx.restore();
  // Turret (drawn in its own rotation)
  const turreted = ["lighttank", "mediumtank", "heavytank", "kolossus", "ranger", "flaktruck", "arctank", "phasetank", "apc"];
  if (turreted.includes(type)) {
    ctx.save();
    ctx.rotate(facingToRadians(turretFacing));
    const big = type === "kolossus";
    ctx.fillStyle = st.light;
    ctx.beginPath();
    ctx.arc(0, 0, big ? 7 : type === "ranger" || type === "flaktruck" ? 3.5 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#222";
    if (type === "heavytank" || big) {
      ctx.fillRect(-3.5, -16, 2, 14);
      ctx.fillRect(1.5, -16, 2, 14);
    } else if (type === "arctank") {
      ctx.fillStyle = "#7ff";
      ctx.beginPath();
      ctx.arc(0, -7, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === "flaktruck") {
      ctx.fillRect(-2, -9, 1.5, 8);
      ctx.fillRect(0.5, -9, 1.5, 8);
    } else if (type === "ranger" || type === "apc") {
      ctx.fillRect(-0.75, -9, 1.5, 7);
    } else {
      ctx.fillRect(-1.25, -15, 2.5, 13);
    }
    ctx.restore();
  }
  if (hpFrac < 0.5) {
    ctx.fillStyle = "rgba(40,40,40,0.5)";
    ctx.beginPath();
    ctx.arc(-3, -3, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function body(ctx: Ctx, st: UnitStyle, w: number, h: number, r: number): void {
  ctx.fillStyle = st.team;
  roundRect(ctx, -w / 2, -h / 2, w, h, r);
  ctx.fill();
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function tracked(ctx: Ctx, st: UnitStyle, w: number, h: number): void {
  ctx.fillStyle = "#2b2b2b";
  ctx.fillRect(-w / 2, -h / 2, 4, h);
  ctx.fillRect(w / 2 - 4, -h / 2, 4, h);
  ctx.fillStyle = st.team;
  ctx.fillRect(-w / 2 + 3, -h / 2 + 1, w - 6, h - 2);
  ctx.strokeStyle = "#1a1a1a";
  ctx.strokeRect(-w / 2 + 3, -h / 2 + 1, w - 6, h - 2);
  ctx.fillStyle = st.dark;
  ctx.fillRect(-w / 2 + 4, -h / 2 + 2, w - 8, 3);
}

function wheeled(ctx: Ctx, st: UnitStyle, type: string): void {
  ctx.fillStyle = "#222";
  for (const y of [-6, 5]) {
    ctx.fillRect(-8, y, 3, 4);
    ctx.fillRect(5, y, 3, 4);
  }
  body(ctx, st, 11, 17, 2);
  ctx.fillStyle = st.dark;
  ctx.fillRect(-4, -7, 8, 4);
  if (type === "rocketlauncher") {
    ctx.fillStyle = "#555";
    ctx.fillRect(-3, -4, 6, 10);
    ctx.fillStyle = "#b33";
    ctx.fillRect(-1.5, -12, 3, 9);
  } else if (type === "jammer") {
    ctx.fillStyle = "#9cf";
    ctx.beginPath();
    ctx.arc(0, 1, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === "mobilegap") {
    ctx.fillStyle = "#a6f";
    ctx.fillRect(-2, -2, 4, 8);
  } else if (type === "demotruck") {
    ctx.fillStyle = "#ee3";
    ctx.fillRect(-4, -2, 8, 8);
    ctx.fillStyle = "#111";
    ctx.fillRect(-1, 0, 2, 4);
  }
}

// ── Aircraft & ships ────────────────────────────────────────────────────────

export function drawAircraft(ctx: Ctx, type: string, facing: number, st: UnitStyle, t: number): void {
  ctx.save();
  ctx.rotate(facingToRadians(facing));
  const heli = type === "hind" || type === "longbow" || type === "transheli";
  ctx.fillStyle = st.team;
  if (heli) {
    roundRect(ctx, -4, -9, 8, 18, 3);
    ctx.fill();
    ctx.fillStyle = st.dark;
    ctx.fillRect(-1.5, 8, 3, 6);
    ctx.strokeStyle = "rgba(20,20,20,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const r = t * 0.8;
    ctx.moveTo(Math.cos(r) * 12, Math.sin(r) * 12);
    ctx.lineTo(-Math.cos(r) * 12, -Math.sin(r) * 12);
    ctx.moveTo(Math.cos(r + 1.57) * 12, Math.sin(r + 1.57) * 12);
    ctx.lineTo(-Math.cos(r + 1.57) * 12, -Math.sin(r + 1.57) * 12);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(3, 4);
    ctx.lineTo(11, 7);
    ctx.lineTo(3, 6);
    ctx.lineTo(2, 10);
    ctx.lineTo(-2, 10);
    ctx.lineTo(-3, 6);
    ctx.lineTo(-11, 7);
    ctx.lineTo(-3, 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawShip(ctx: Ctx, type: string, facing: number, st: UnitStyle, cloaked: boolean): void {
  ctx.save();
  ctx.rotate(facingToRadians(facing));
  ctx.globalAlpha = cloaked ? 0.35 : 1;
  const len = type === "cruiser" ? 30 : type === "gunboat" ? 16 : type === "sub" ? 18 : 24;
  ctx.fillStyle = "#3a3f47";
  ctx.beginPath();
  ctx.moveTo(0, -len / 2);
  ctx.lineTo(5, -len / 4);
  ctx.lineTo(5, len / 2);
  ctx.lineTo(-5, len / 2);
  ctx.lineTo(-5, -len / 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = st.team;
  ctx.fillRect(-3, -len / 4, 6, len / 2);
  if (type === "cruiser") {
    ctx.fillStyle = "#222";
    ctx.fillRect(-1, -len / 2 + 2, 2, 8);
    ctx.fillRect(-1, len / 2 - 10, 2, 8);
  }
  ctx.restore();
}

// ── Structures ──────────────────────────────────────────────────────────────

export function drawStructure(ctx: Ctx, type: string, w: number, h: number, st: UnitStyle, buildup: number, hpFrac: number, t: number, disabled: boolean): void {
  const W = w * CELL_PX;
  const H = h * CELL_PX;
  ctx.save();
  // Build-up: rise from the ground.
  if (buildup < 1) {
    ctx.translate(0, (H / 2) * (1 - buildup));
    ctx.scale(1, Math.max(0.05, buildup));
  }
  if (type === "mine") {
    ctx.fillStyle = "#3a3a2a";
    ctx.beginPath();
    ctx.arc(0, 1, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e33";
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    return;
  }
  // Slab / bib
  ctx.fillStyle = "#4b4b46";
  roundRect(ctx, -W / 2 - 2, -H / 2 - 2, W + 4, H + 4, 3);
  ctx.fill();
  const roof = hpFrac < 0.5 ? shade("#8a8f96", -0.35) : "#8a8f96";
  ctx.fillStyle = roof;
  ctx.fillRect(-W / 2, -H / 2, W, H);
  // Team trim
  ctx.fillStyle = st.team;
  ctx.fillRect(-W / 2, -H / 2, W, 4);
  switch (type) {
    case "conyard":
    case "fakeconyard":
      ctx.fillStyle = "#6a6e75";
      ctx.fillRect(-W / 2 + 6, -H / 2 + 8, W - 12, H - 14);
      ctx.fillStyle = "#e0b040";
      ctx.fillRect(-4, -H / 2 + 10, 8, H - 20); // crane arm
      ctx.fillStyle = st.dark;
      ctx.fillRect(-W / 2 + 8, H / 2 - 10, 14, 6);
      break;
    case "power":
    case "apower": {
      const stacks = type === "power" ? 2 : 3;
      for (let i = 0; i < stacks; i++) {
        const x = -W / 2 + (i + 0.5) * (W / stacks);
        ctx.fillStyle = "#555a60";
        ctx.beginPath();
        ctx.arc(x, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = disabled ? "#333" : "#e8e8e8";
        ctx.beginPath();
        ctx.arc(x, 0, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = st.dark;
      ctx.fillRect(-W / 2 + 4, H / 2 - 8, W - 8, 4);
      break;
    }
    case "refinery":
      ctx.fillStyle = "#5c6067";
      ctx.beginPath();
      ctx.arc(W / 2 - 14, -H / 2 + 16, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#d9a441";
      ctx.beginPath();
      ctx.arc(W / 2 - 14, -H / 2 + 16, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3d4046";
      ctx.fillRect(-W / 2 + 4, H / 2 - 22, 22, 18); // dock bay
      ctx.fillStyle = "#e0b040";
      ctx.fillRect(-W / 2 + 6, H / 2 - 6, 18, 3);
      break;
    case "silo":
      ctx.fillStyle = "#d9a441";
      ctx.beginPath();
      ctx.arc(0, 1, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#5a4a1a";
      ctx.stroke();
      break;
    case "barracks":
      ctx.fillStyle = st.dark;
      for (let i = 0; i < 3; i++) ctx.fillRect(-W / 2 + 4 + i * 14, -H / 2 + 10, 10, H - 18);
      break;
    case "kennel":
      ctx.fillStyle = "#6b4a2a";
      ctx.fillRect(-8, -6, 16, 12);
      ctx.fillStyle = "#222";
      ctx.fillRect(-3, -1, 6, 7);
      break;
    case "factory":
    case "fakefactory":
      ctx.fillStyle = "#3d4046";
      ctx.fillRect(-W / 2 + 6, -2, W - 12, H / 2); // doors
      ctx.fillStyle = st.dark;
      ctx.fillRect(-W / 2 + 6, -2, W - 12, 3);
      ctx.fillStyle = "#c8c8c8";
      for (let i = 0; i < 3; i++) ctx.fillRect(-W / 2 + 10 + i * 20, -H / 2 + 8, 12, 6);
      break;
    case "radar": {
      ctx.fillStyle = "#555a60";
      ctx.beginPath();
      ctx.arc(0, 2, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(0, 2);
      ctx.rotate(disabled ? 0 : t * 1.2);
      ctx.fillStyle = "#e8e8e8";
      ctx.beginPath();
      ctx.ellipse(0, -5, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case "depot":
      ctx.fillStyle = "#e0b040";
      ctx.fillRect(-W / 2 + 6, -H / 2 + 8, W - 12, H - 16);
      ctx.fillStyle = "#3d4046";
      ctx.fillRect(-W / 2 + 10, -H / 2 + 12, W - 20, H - 24);
      ctx.fillStyle = "#e0b040";
      ctx.fillRect(-2, -12, 4, 24);
      ctx.fillRect(-12, -2, 24, 4);
      break;
    case "techcenter":
      ctx.fillStyle = "#6a6e75";
      ctx.fillRect(-W / 2 + 6, -H / 2 + 8, W - 12, H - 14);
      ctx.fillStyle = disabled ? "#345" : "#5cf";
      ctx.fillRect(-W / 2 + 10, -H / 2 + 12, W - 20, 6);
      ctx.fillRect(-W / 2 + 10, -H / 2 + 22, W - 20, 6);
      break;
    case "helipad":
    case "airfield":
      ctx.fillStyle = "#3a3d42";
      ctx.fillRect(-W / 2 + 3, -H / 2 + 6, W - 6, H - 9);
      ctx.strokeStyle = "#e8e8e8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 1, Math.min(W, H) / 3, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "navalyard":
    case "subpen":
      ctx.fillStyle = "#2f5f8f";
      ctx.fillRect(-W / 2 + 8, -H / 2 + 12, W - 16, H - 14);
      ctx.fillStyle = "#6a6e75";
      ctx.fillRect(-W / 2 + 4, -H / 2 + 6, 8, H - 8);
      ctx.fillRect(W / 2 - 12, -H / 2 + 6, 8, H - 8);
      break;
    case "pillbox":
    case "camopillbox":
      ctx.fillStyle = type === "camopillbox" ? "#5a6a3a" : "#7a7a72";
      ctx.beginPath();
      ctx.arc(0, 1, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.fillRect(-6, -1, 12, 3);
      break;
    case "turret":
    case "aagun":
    case "samsite":
    case "flametower":
    case "arctower":
      // Base only; the turret/coil is drawn by drawTurret so it can rotate.
      ctx.fillStyle = "#6a6e75";
      ctx.beginPath();
      ctx.arc(0, 1, Math.min(W, H) / 2 - 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "sandbag":
      ctx.fillStyle = "#b8a878";
      ctx.fillRect(-W / 2, -H / 2, W, H);
      ctx.strokeStyle = "#8a7a50";
      ctx.strokeRect(-W / 2 + 2, -H / 2 + 2, W - 4, H - 4);
      break;
    case "wire":
      ctx.fillStyle = "#6f7a48";
      ctx.fillRect(-W / 2, -H / 2, W, H);
      ctx.strokeStyle = "#aaa";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-W / 2, 0);
      ctx.lineTo(W / 2, 0);
      ctx.moveTo(0, -H / 2);
      ctx.lineTo(0, H / 2);
      ctx.stroke();
      break;
    case "concrete":
      ctx.fillStyle = "#9a9a9a";
      ctx.fillRect(-W / 2, -H / 2, W, H);
      ctx.strokeStyle = "#555";
      ctx.strokeRect(-W / 2 + 1, -H / 2 + 1, W - 2, H - 2);
      break;
    case "gate":
      ctx.fillStyle = "#9a9a9a";
      ctx.fillRect(-W / 2, -H / 2, W, H);
      ctx.fillStyle = "#333";
      ctx.fillRect(-W / 2 + 3, -2, W - 6, 4);
      ctx.fillStyle = st.team;
      ctx.fillRect(-W / 2, -H / 2, 4, H);
      ctx.fillRect(W / 2 - 4, -H / 2, 4, H);
      break;
    case "mine":
      ctx.fillStyle = "#3a3a2a";
      ctx.beginPath();
      ctx.arc(0, 1, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e33";
      ctx.fillRect(-1, -1, 2, 2);
      break;
    case "gapgen":
      ctx.fillStyle = disabled ? "#425" : "#a6f";
      ctx.beginPath();
      ctx.arc(0, 4, 7, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "phasegate":
      ctx.strokeStyle = disabled ? "#357" : "#5df";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 2, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 2, 6 + Math.sin(t * 3) * 2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "aegis":
      ctx.strokeStyle = disabled ? "#733" : "#f66";
      ctx.lineWidth = 3;
      ctx.strokeRect(-12, -10, 24, 24);
      ctx.beginPath();
      ctx.arc(0, 2, 5 + Math.sin(t * 3) * 2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case "missilesilo":
      ctx.fillStyle = "#3d4046";
      ctx.beginPath();
      ctx.arc(-W / 4, 1, 8, 0, Math.PI * 2);
      ctx.arc(W / 4, 1, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e33";
      ctx.fillRect(-W / 4 - 2, -3, 4, 8);
      ctx.fillRect(W / 4 - 2, -3, 4, 8);
      break;
    case "oilderrick":
      ctx.fillStyle = "#333";
      ctx.fillRect(-2, -H / 2 + 6, 4, H - 10);
      ctx.fillStyle = "#e0b040";
      ctx.fillRect(-9, -8 + Math.sin(t * 2) * 4, 18, 3);
      break;
    default:
      ctx.fillStyle = "#a89a7a";
      ctx.fillRect(-W / 2 + 4, -H / 2 + 8, W - 8, H - 12);
      ctx.fillStyle = "#6a3a2a";
      ctx.fillRect(-W / 2 + 4, -H / 2 + 8, W - 8, 6);
  }
  ctx.restore();
}

export function drawTurret(ctx: Ctx, type: string, turretFacing: number, st: UnitStyle, disabled: boolean, t: number): void {
  ctx.save();
  ctx.rotate(facingToRadians(turretFacing));
  switch (type) {
    case "turret":
      ctx.fillStyle = st.light;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#222";
      ctx.fillRect(-1.5, -16, 3, 14);
      break;
    case "aagun":
      ctx.fillStyle = st.light;
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#222";
      ctx.fillRect(-3, -12, 2, 10);
      ctx.fillRect(1, -12, 2, 10);
      break;
    case "samsite":
      ctx.fillStyle = st.dark;
      ctx.fillRect(-9, -4, 18, 8);
      ctx.fillStyle = "#ddd";
      ctx.fillRect(-7, -10, 3, 9);
      ctx.fillRect(-1.5, -10, 3, 9);
      ctx.fillRect(4, -10, 3, 9);
      break;
    case "flametower":
      ctx.fillStyle = "#7a3a1a";
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f83";
      ctx.beginPath();
      ctx.arc(0, -3, 3 + Math.sin(t * 6), 0, Math.PI * 2);
      ctx.fill();
      break;
    case "arctower":
      ctx.fillStyle = "#333";
      ctx.fillRect(-2, -12, 4, 14);
      ctx.fillStyle = disabled ? "#466" : "#7ff";
      ctx.beginPath();
      ctx.arc(0, -13, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

export function drawCrate(ctx: Ctx, t: number): void {
  const bob = Math.sin(t * 3) * 1.5;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(0, 7, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#b8862a";
  ctx.fillRect(-7, -7 + bob, 14, 14);
  ctx.strokeStyle = "#5a3f10";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-7, -7 + bob, 14, 14);
  ctx.beginPath();
  ctx.moveTo(-7, -7 + bob);
  ctx.lineTo(7, 7 + bob);
  ctx.moveTo(7, -7 + bob);
  ctx.lineTo(-7, 7 + bob);
  ctx.stroke();
  ctx.fillStyle = "#ffe";
  ctx.fillRect(-2, -2 + bob, 4, 4);
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Small icon for the sidebar: draws the unit/structure in a 60x44 box. */
export function drawIcon(ctx: Ctx, type: string, isStructure: boolean, w: number, h: number, st: UnitStyle, cls: string): void {
  ctx.save();
  ctx.translate(30, 22);
  if (isStructure) {
    const scale = Math.min(48 / (w * CELL_PX), 36 / (h * CELL_PX));
    ctx.scale(scale, scale);
    drawStructure(ctx, type, w, h, st, 1, 1, 0, false);
    drawTurret(ctx, type, 28, st, false, 0);
  } else {
    ctx.scale(1.6, 1.6);
    if (cls === "infantry") drawInfantry(ctx, type, 28, st, false, 0);
    else if (cls === "aircraft") drawAircraft(ctx, type, 28, st, 0);
    else if (cls === "ship") drawShip(ctx, type, 28, st, false);
    else drawVehicle(ctx, type, 28, 28, st, 1);
  }
  ctx.restore();
}
