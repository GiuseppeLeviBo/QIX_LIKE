import {
  TICK_MS, TARGET_PERCENT, COLS, ROWS, CELL_PX as CELL,
  ATTRACT_SPLASH_MS as SPLASH_DURATION, ATTRACT_DEMO_MS as DEMO_DURATION,
  ATTRACT_SCORES_MS as SCORES_DURATION, LEVEL_COMPLETE_DURATION_MS as LEVEL_COMPLETE_DURATION,
} from "./config/gameplayConstants";
import { useEffect, useRef, useState } from "react";
import {
  configureGameEngineEffects,
  createInitialGame,
  DIRS,
  key,
  stepDemoGame,
  stepGame,
  syncLegacyFieldsFromPlayer,
  updatePlayerState,
  type Game,
  type GameStatus,
  type PlayerState,
  type Point,
} from "./game/gameEngine";

type QixDebugSnapshot = {
  isAttract: boolean;
  attractPhase: "splash" | "demo" | "attractScores";
  game: {
    player: Point;
    dir: Point;
    drawing: boolean;
    trailLength: number;
    score: number;
    percent: number;
    lives: number;
    level: number;
    status: GameStatus;
    message: string;
    qix: { x: number; y: number; vx: number; vy: number };
    sparks: number;
    items: number;
    claimedCells: number;
    shieldTimer: number;
    speedTimer: number;
    slowTimer: number;
    monsterSpeedTimer: number;
    spaceHeld: boolean;
  };
  players: Record<string, {
    position: Point;
    dir: Point;
    drawing: boolean;
    trailLength: number;
    score: number;
    lives: number;
    spaceHeld: boolean;
  }>;
};

declare global {
  interface Window {
    __QIX_DEBUG__?: {
      getSnapshot: () => QixDebugSnapshot;
    };
  }
}

type HighScore = {
  initials: string;
  score: number;
  level: number;
};

const HIGH_SCORES_KEY = "qix_high_scores";
const MAX_HIGH_SCORES = 10;

const PLAYER_COLORS = [
  { core: "#00ffff", trail: "#ffff00", slowTrail: "#ff3300", engine: "#0088ff" },
  { core: "#ff4dff", trail: "#ff8cff", slowTrail: "#ff5c33", engine: "#b000ff" },
  { core: "#6dff6d", trail: "#b7ff45", slowTrail: "#ffcc33", engine: "#00aa44" },
  { core: "#ffb347", trail: "#ffd166", slowTrail: "#ff5c33", engine: "#ff7a00" },
];

const OWNER_TERRITORY_COLORS = [
  { base: [10, 30, 120], shade: [0.3, 0.5, 1], glow: "rgba(0, 100, 255, 0.15)" },
  { base: [95, 18, 110], shade: [0.7, 0.25, 0.9], glow: "rgba(255, 77, 255, 0.16)" },
  { base: [20, 95, 55], shade: [0.25, 0.8, 0.35], glow: "rgba(109, 255, 109, 0.14)" },
  { base: [120, 65, 18], shade: [0.8, 0.45, 0.2], glow: "rgba(255, 179, 71, 0.15)" },
];

function getPlayerPalette(player: PlayerState, index: number) {
  const idIndex = Number(player.id.replace(/\D/g, "")) - 1;
  const paletteIndex = Number.isFinite(idIndex) && idIndex >= 0 ? idIndex : index;
  return PLAYER_COLORS[paletteIndex % PLAYER_COLORS.length] ?? PLAYER_COLORS[0];
}

function getOwnerTerritoryPalette(owner: string | null) {
  const idIndex = owner ? Number(owner.replace(/\D/g, "")) - 1 : 0;
  const paletteIndex = Number.isFinite(idIndex) && idIndex >= 0 ? idIndex : 0;
  return OWNER_TERRITORY_COLORS[paletteIndex % OWNER_TERRITORY_COLORS.length] ?? OWNER_TERRITORY_COLORS[0];
}

function loadHighScores(): HighScore[] {
  try {
    const data = localStorage.getItem(HIGH_SCORES_KEY);
    if (data) return JSON.parse(data);
  } catch {
    // ignore
  }
  return [];
}

function saveHighScores(scores: HighScore[]) {
  try {
    localStorage.setItem(HIGH_SCORES_KEY, JSON.stringify(scores));
  } catch {
    // ignore
  }
}

function addHighScore(scores: HighScore[], newScore: HighScore): HighScore[] {
  const updated = [...scores, newScore]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_HIGH_SCORES);
  saveHighScores(updated);
  return updated;
}

// â”€â”€ Particle system for explosions â”€â”€
let particles: { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }[] = [];

function spawnExplosion(x: number, y: number, color: string, count = 20) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 3;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 30 + Math.random() * 20,
      color,
      size: 2 + Math.random() * 3,
    });
  }
}

function updateParticles() {
  particles = particles.filter(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.life -= 1;
    return p.life > 0;
  });
}

function drawParticles(ctx: CanvasRenderingContext2D) {
  for (const p of particles) {
    const alpha = p.life / 50;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// â”€â”€ Frame counter for animations â”€â”€
let frameCount = 0;

function drawGame(ctx: CanvasRenderingContext2D, game: Game) {
  frameCount++;
  const w = COLS * CELL;
  const h = ROWS * CELL;

  // â”€â”€ Background: deep space with subtle starfield â”€â”€
  ctx.fillStyle = "#000008";
  ctx.fillRect(0, 0, w, h);

  // Animated starfield
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  for (let i = 0; i < 60; i++) {
    const sx = ((i * 137.5 + frameCount * 0.02) % w);
    const sy = ((i * 97.3 + frameCount * 0.01) % h);
    const size = (Math.sin(frameCount * 0.05 + i) + 1) * 0.5 + 0.5;
    ctx.fillRect(sx, sy, size, size);
  }

  // â”€â”€ Grid overlay (Tron-style) â”€â”€
  ctx.strokeStyle = "rgba(0, 255, 255, 0.06)";
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= COLS; x += 2) {
    ctx.beginPath();
    ctx.moveTo(x * CELL, 0);
    ctx.lineTo(x * CELL, h);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y += 2) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL);
    ctx.lineTo(w, y * CELL);
    ctx.stroke();
  }

  // â”€â”€ Claimed territory with gradient fill â”€â”€
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (game.claimed[y][x]) {
        const isBorder = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
        const isSlowClaimed = game.slowClaimed.has(key(x, y));
        if (isBorder) {
          // Neon green border
          const pulse = Math.sin(frameCount * 0.08 + x * 0.1 + y * 0.1) * 0.3 + 0.7;
          ctx.fillStyle = `rgba(0, 255, 65, ${0.4 * pulse})`;
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
          ctx.fillStyle = `rgba(0, 255, 65, ${0.8 * pulse})`;
          ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
        } else if (isSlowClaimed) {
          // Slow-claimed area: deep red with subtle animation
          const shade = Math.sin(frameCount * 0.03 + x * 0.15 + y * 0.15) * 15;
          const r = 100 + shade * 0.5;
          const g = 15 + shade * 0.2;
          const b = 20 + shade * 0.3;
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
          // Subtle inner glow
          ctx.fillStyle = `rgba(255, 50, 0, 0.15)`;
          ctx.fillRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4);
        } else {
          // Claimed territory colored by ownerGrid. p1 keeps the classic deep blue.
          const owner = game.ownerGrid[y]?.[x] ?? null;
          const territory = getOwnerTerritoryPalette(owner);
          const shade = Math.sin(frameCount * 0.03 + x * 0.15 + y * 0.15) * 15;
          const r = territory.base[0] + shade * territory.shade[0];
          const g = territory.base[1] + shade * territory.shade[1];
          const b = territory.base[2] + shade * territory.shade[2];
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
          ctx.fillStyle = territory.glow;
          ctx.fillRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4);
        }
      }
    }
  }

  // â”€â”€ Border glow effect â”€â”€
  ctx.shadowColor = "#00ff41";
  ctx.shadowBlur = 12;
  ctx.strokeStyle = "#00ff41";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.shadowBlur = 0;

  // â”€â”€ Items (Power-ups & Threats - retro 80s icons) â”€â”€
  for (const item of game.items) {
    const px = item.x * CELL + CELL / 2;
    const py = item.y * CELL + CELL / 2;
    
    ctx.save();
    ctx.translate(px, py);
    
    // Pulsing effect
    const pulse = Math.sin(frameCount * 0.1) * 0.2 + 0.8;
    
    if (item.type === "COINS") {
      // Golden coin with glow
      ctx.shadowColor = "#ffea00";
      ctx.shadowBlur = 10 * pulse;
      ctx.fillStyle = "#ffea00";
      ctx.beginPath();
      ctx.arc(0, 0, CELL * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff7b2";
      ctx.beginPath();
      ctx.arc(0, 0, CELL * 0.25, 0, Math.PI * 2);
      ctx.fill();
    } else if (item.type === "SHIELD") {
      // Blue shield
      ctx.shadowColor = "#00ffff";
      ctx.shadowBlur = 10 * pulse;
      ctx.fillStyle = "#00ffff";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -CELL * 0.5);
      ctx.lineTo(CELL * 0.4, -CELL * 0.2);
      ctx.lineTo(CELL * 0.4, CELL * 0.3);
      ctx.lineTo(0, CELL * 0.5);
      ctx.lineTo(-CELL * 0.4, CELL * 0.3);
      ctx.lineTo(-CELL * 0.4, -CELL * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (item.type === "ROCKET") {
      // Red/orange rocket
      ctx.shadowColor = "#ff5500";
      ctx.shadowBlur = 10 * pulse;
      ctx.fillStyle = "#ff5500";
      // Body
      ctx.fillRect(-CELL * 0.15, -CELL * 0.3, CELL * 0.3, CELL * 0.5);
      // Nose
      ctx.beginPath();
      ctx.moveTo(0, -CELL * 0.5);
      ctx.lineTo(-CELL * 0.15, -CELL * 0.3);
      ctx.lineTo(CELL * 0.15, -CELL * 0.3);
      ctx.closePath();
      ctx.fill();
      // Fins
      ctx.fillStyle = "#ffaa00";
      ctx.beginPath();
      ctx.moveTo(-CELL * 0.15, CELL * 0.2);
      ctx.lineTo(-CELL * 0.4, CELL * 0.4);
      ctx.lineTo(-CELL * 0.15, CELL * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(CELL * 0.15, CELL * 0.2);
      ctx.lineTo(CELL * 0.4, CELL * 0.4);
      ctx.lineTo(CELL * 0.15, CELL * 0.4);
      ctx.closePath();
      ctx.fill();
    } else if (item.type === "1-UP") {
      // Green 1-UP (heart or cross)
      ctx.shadowColor = "#00ff66";
      ctx.shadowBlur = 10 * pulse;
      ctx.fillStyle = "#00ff66";
      // Simple cross or "1" with up arrow
      ctx.fillRect(-CELL * 0.1, -CELL * 0.4, CELL * 0.2, CELL * 0.8);
      ctx.fillRect(-CELL * 0.3, -CELL * 0.1, CELL * 0.6, CELL * 0.2);
      // Arrow up
      ctx.beginPath();
      ctx.moveTo(0, -CELL * 0.6);
      ctx.lineTo(-CELL * 0.2, -CELL * 0.4);
      ctx.lineTo(CELL * 0.2, -CELL * 0.4);
      ctx.closePath();
      ctx.fill();
    } else if (item.type === "SLOW") {
      // Purple slow icon (down arrow)
      ctx.shadowColor = "#aa00ff";
      ctx.shadowBlur = 10 * pulse;
      ctx.fillStyle = "#aa00ff";
      ctx.beginPath();
      ctx.moveTo(0, CELL * 0.4);
      ctx.lineTo(-CELL * 0.3, -CELL * 0.3);
      ctx.lineTo(CELL * 0.3, -CELL * 0.3);
      ctx.closePath();
      ctx.fill();
    } else if (item.type === "FAST_MONSTER") {
      // Red fast monster (spiky circle)
      ctx.shadowColor = "#ff0000";
      ctx.shadowBlur = 10 * pulse;
      ctx.fillStyle = "#ff0000";
      ctx.beginPath();
      ctx.arc(0, 0, CELL * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, 0, CELL * 0.15, 0, Math.PI * 2);
      ctx.fill();
    } else if (item.type === "BOMB") {
      // Black bomb with fuse
      ctx.shadowColor = "#000000";
      ctx.shadowBlur = 8 * pulse;
      ctx.fillStyle = "#222222";
      ctx.beginPath();
      ctx.arc(0, 0, CELL * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(-CELL * 0.1, -CELL * 0.45, CELL * 0.2, CELL * 0.2);
      ctx.fillStyle = "#ffff00";
      ctx.fillRect(-CELL * 0.05, -CELL * 0.6, CELL * 0.1, CELL * 0.2);
    }
    
    ctx.restore();
  }

  // Player trails.
  Object.values(game.players).forEach((player, playerIndex) => {
    const palette = getPlayerPalette(player, playerIndex);
    const trailLen = player.trail.length;
    for (let i = 0; i < trailLen; i++) {
      const p = player.trail[i];
      const t = i / Math.max(trailLen - 1, 1);
      const size = 4 + t * 6;
      const offset = (CELL - size) / 2;
      const isFuse = player.fuseIndex > 0 && i <= player.fuseIndex;

      if (isFuse) {
        const isFlash = Math.floor(frameCount / 3) % 2 === 0;
        const fuseColor = isFlash ? "#ff3700" : "#ff9900";
        ctx.shadowColor = fuseColor;
        ctx.shadowBlur = 12;
        ctx.fillStyle = fuseColor;
        ctx.fillRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2);
      } else if (player.slowDrawUsed || (player.drawing && player.spaceHeld)) {
        const alpha = 0.4 + t * 0.6;
        ctx.shadowColor = palette.slowTrail;
        ctx.shadowBlur = 10 + t * 8;
        ctx.fillStyle = `rgba(255, 50, 0, ${alpha * 0.3})`;
        ctx.fillRect(p.x * CELL, p.y * CELL, CELL, CELL);
        ctx.fillStyle = `rgba(255, 80, 20, ${alpha})`;
        ctx.fillRect(p.x * CELL + offset, p.y * CELL + offset, size, size);
      } else {
        const alpha = 0.4 + t * 0.6;
        ctx.shadowColor = palette.trail;
        ctx.shadowBlur = 10 + t * 8;
        ctx.fillStyle = playerIndex === 0
          ? `rgba(255, 255, 0, ${alpha * 0.3})`
          : `${palette.trail}55`;
        ctx.fillRect(p.x * CELL, p.y * CELL, CELL, CELL);
        ctx.fillStyle = playerIndex === 0
          ? `rgba(255, 255, 0, ${alpha})`
          : palette.trail;
        ctx.globalAlpha = alpha;
        ctx.fillRect(p.x * CELL + offset, p.y * CELL + offset, size, size);
        ctx.globalAlpha = 1;
      }
    }
  });
  ctx.shadowBlur = 0;

  // â”€â”€ QIX: menacing plasma entity â”€â”€
  const q = game.qix;
  const qx = q.x * CELL + CELL / 2;
  const qy = q.y * CELL + CELL / 2;

  // Outer aura
  const auraGrad = ctx.createRadialGradient(qx, qy, 0, qx, qy, CELL * 4);
  auraGrad.addColorStop(0, "rgba(255, 0, 100, 0.15)");
  auraGrad.addColorStop(1, "rgba(255, 0, 100, 0)");
  ctx.fillStyle = auraGrad;
  ctx.fillRect(qx - CELL * 4, qy - CELL * 4, CELL * 8, CELL * 8);

  // Main body: rotating plasma shape
  ctx.save();
  ctx.translate(qx, qy);
  ctx.rotate(q.phase * 0.5);

  // Multiple overlapping shapes for plasma effect
  for (let layer = 0; layer < 3; layer++) {
    const layerOffset = layer * 0.4;
    const colors = ["#ff0066", "#ff3399", "#ff66cc"];
    ctx.strokeStyle = colors[layer];
    ctx.lineWidth = 3 - layer;
    ctx.shadowColor = colors[layer];
    ctx.shadowBlur = 20 - layer * 5;

    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const angle = q.phase * (1 + layer * 0.3) + i * (Math.PI * 2 / 12) + layerOffset;
      const radius = CELL * (1.8 + Math.sin(q.phase * 2 + i * 0.8 + layer) * 0.8);
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle * 1.2 + layerOffset) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Core glow
  const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, CELL * 1.5);
  coreGrad.addColorStop(0, "rgba(255, 255, 255, 0.6)");
  coreGrad.addColorStop(0.5, "rgba(255, 0, 100, 0.3)");
  coreGrad.addColorStop(1, "rgba(255, 0, 100, 0)");
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(0, 0, CELL * 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.shadowBlur = 0;

  // â”€â”€ Sparx: glowing spinning crosses â”€â”€
  for (const spark of game.sparks) {
    const sx = spark.x * CELL + CELL / 2;
    const sy = spark.y * CELL + CELL / 2;
    const pulse = Math.sin(frameCount * 0.3) * 0.2 + 0.8;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(frameCount * 0.25);

    ctx.shadowColor = "#ff3700";
    ctx.shadowBlur = 12;
    ctx.strokeStyle = `rgba(255, 60, 0, ${pulse})`;
    ctx.lineWidth = 3;

    // Draw a spinning cross (arcade style)
    ctx.beginPath();
    ctx.moveTo(-CELL * 0.7, 0);
    ctx.lineTo(CELL * 0.7, 0);
    ctx.moveTo(0, -CELL * 0.7);
    ctx.lineTo(0, CELL * 0.7);
    ctx.stroke();

    // Inner bright core
    ctx.strokeStyle = `rgba(255, 255, 200, ${pulse})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-CELL * 0.4, 0);
    ctx.lineTo(CELL * 0.4, 0);
    ctx.moveTo(0, -CELL * 0.4);
    ctx.lineTo(0, CELL * 0.4);
    ctx.stroke();

    ctx.restore();
  }
  ctx.shadowBlur = 0;

  // Player ships.
  Object.values(game.players).forEach((player, playerIndex) => {
    const palette = getPlayerPalette(player, playerIndex);
    const px = player.position.x * CELL + CELL / 2;
    const py = player.position.y * CELL + CELL / 2;
    const playerColor = player.drawing
      ? (player.slowDrawUsed || player.spaceHeld ? palette.slowTrail : palette.trail)
      : palette.core;
    const playerPulse = Math.sin(frameCount * 0.15 + playerIndex * 0.6) * 0.2 + 0.8;

    const playerAura = ctx.createRadialGradient(px, py, 0, px, py, CELL * 2);
    playerAura.addColorStop(0, `${playerColor}40`);
    playerAura.addColorStop(1, `${playerColor}00`);
    ctx.fillStyle = playerAura;
    ctx.fillRect(px - CELL * 2, py - CELL * 2, CELL * 4, CELL * 4);

    ctx.save();
    ctx.translate(px, py);

    let angle = 0;
    if (player.dir.x === 1) angle = 0;
    else if (player.dir.x === -1) angle = Math.PI;
    else if (player.dir.y === -1) angle = -Math.PI / 2;
    else if (player.dir.y === 1) angle = Math.PI / 2;
    ctx.rotate(angle);

    ctx.shadowColor = playerColor;
    ctx.shadowBlur = 16;
    ctx.fillStyle = playerColor;

    ctx.beginPath();
    ctx.moveTo(CELL * 0.6, 0);
    ctx.lineTo(-CELL * 0.4, -CELL * 0.4);
    ctx.lineTo(-CELL * 0.2, 0);
    ctx.lineTo(-CELL * 0.4, CELL * 0.4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = player.drawing ? "#ff6600" : palette.engine;
    ctx.shadowColor = player.drawing ? "#ff6600" : palette.engine;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(-CELL * 0.25, 0, CELL * 0.15 * playerPulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });
  ctx.shadowBlur = 0;

  // â”€â”€ Particles â”€â”€
  updateParticles();
  drawParticles(ctx);

  // â”€â”€ Floating Texts â”€â”€
  ctx.save();
  ctx.font = "bold 12px 'Press Start 2P'";
  ctx.textAlign = "center";
  for (const ft of game.floatingTexts) {
    const alpha = Math.min(1, ft.life / 20);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = ft.color;
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 4;
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.restore();

  // â”€â”€ CRT Scanlines overlay â”€â”€
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  for (let y = 0; y < h; y += 3) {
    ctx.fillRect(0, y, w, 1);
  }

  // â”€â”€ Vignette â”€â”€
  const vignette = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.7);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  // â”€â”€ HUD overlay on canvas â”€â”€
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(0, 255, 65, 0.9)";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`LVL ${game.level}`, 8, 16);
  ctx.textAlign = "center";
  ctx.fillText(`SCORE ${game.score.toString().padStart(7, "0")}`, w / 2, 16);
  ctx.textAlign = "right";
  ctx.fillText(`${game.percent}%/${TARGET_PERCENT}%`, w - 8, 16);

  // Effect countdown timers (visible when effects are active)
  ctx.save();
  ctx.font = "bold 10px 'Press Start 2P'";
  ctx.textAlign = "right";
  let offsetTimer = 32;
  if (game.shieldTimer > 0) {
    ctx.fillStyle = "#00ffff";
    ctx.fillText(`SHIELD: ${(game.shieldTimer * TICK_MS / 1000).toFixed(1)}s`, w - 8, offsetTimer);
    offsetTimer += 14;
  }
  if (game.speedTimer > 0) {
    ctx.fillStyle = "#ff5500";
    ctx.fillText(`SPEED UP: ${(game.speedTimer * TICK_MS / 1000).toFixed(1)}s`, w - 8, offsetTimer);
    offsetTimer += 14;
  }
  if (game.monsterSpeedTimer > 0) {
    ctx.fillStyle = "#ff0000";
    ctx.fillText(`FAST MONSTERS: ${(game.monsterSpeedTimer * TICK_MS / 1000).toFixed(1)}s`, w - 8, offsetTimer);
    offsetTimer += 14;
  }
  ctx.restore();

  // Lives as small ship icons
  for (let i = 0; i < game.lives; i++) {
    ctx.fillStyle = "#00ffff";
    ctx.shadowColor = "#00ffff";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(16 + i * 16, h - 8);
    ctx.lineTo(8 + i * 16, h - 14);
    ctx.lineTo(10 + i * 16, h - 11);
    ctx.lineTo(8 + i * 16, h - 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef(createInitialGame());
  const [hud, setHud] = useState(gameRef.current);
  const [highScores, setHighScores] = useState<HighScore[]>(() => loadHighScores());
  const [initials, setInitials] = useState("");
  const [isAttract, setIsAttract] = useState(true);
  const [attractPhase, setAttractPhase] = useState<"splash" | "demo" | "attractScores">("splash");
  const [insertCoinBlink, setInsertCoinBlink] = useState(true);
  const [levelCountdown, setLevelCountdown] = useState(5);
  const attractTimerRef = useRef(0);
  const attractPhaseRef = useRef<"splash" | "demo" | "attractScores">("splash");
  const isAttractRef = useRef(true);
  const idleTimerRef = useRef(0);
  const levelTransitionTimerRef = useRef(0);

  const sync = () => {
    gameRef.current = syncLegacyFieldsFromPlayer(gameRef.current);
    setHud({ ...gameRef.current });
  };

  useEffect(() => {
    configureGameEngineEffects({
      spawnExplosion,
      scheduleEffect: (callback, delayMs) => {
        window.setTimeout(callback, delayMs);
      },
    });

    return () => configureGameEngineEffects({});
  }, []);

  useEffect(() => {
    const getSnapshot = (): QixDebugSnapshot => {
      const current = gameRef.current;
      const claimedCells = current.claimed.reduce(
        (total, row) => total + row.filter(Boolean).length,
        0
      );

      return {
        isAttract: isAttractRef.current,
        attractPhase: attractPhaseRef.current,
        game: {
          player: { ...current.player },
          dir: { ...current.dir },
          drawing: current.drawing,
          trailLength: current.trail.length,
          score: current.score,
          percent: current.percent,
          lives: current.lives,
          level: current.level,
          status: current.status,
          message: current.message,
          qix: {
            x: current.qix.x,
            y: current.qix.y,
            vx: current.qix.vx,
            vy: current.qix.vy,
          },
          sparks: current.sparks.length,
          items: current.items.length,
          claimedCells,
          shieldTimer: current.shieldTimer,
          speedTimer: current.speedTimer,
          slowTimer: current.slowTimer,
          monsterSpeedTimer: current.monsterSpeedTimer,
          spaceHeld: current.spaceHeld,
        },
        players: Object.fromEntries(
          Object.entries(current.players).map(([id, player]) => [
            id,
            {
              position: { ...player.position },
              dir: { ...player.dir },
              drawing: player.drawing,
              trailLength: player.trail.length,
              score: player.score,
              lives: player.lives,
              spaceHeld: player.spaceHeld,
            },
          ])
        ),
      };
    };

    window.__QIX_DEBUG__ = { getSnapshot };
    return () => {
      if (window.__QIX_DEBUG__?.getSnapshot === getSnapshot) {
        delete window.__QIX_DEBUG__;
      }
    };
  }, []);

  const returnToAttract = () => {
    isAttractRef.current = true;
    setIsAttract(true);
    attractPhaseRef.current = "splash";
    setAttractPhase("splash");
    attractTimerRef.current = 0;
    idleTimerRef.current = 0;
    levelTransitionTimerRef.current = 0;
    setLevelCountdown(5);
    setInitials("");
    gameRef.current = createInitialGame(1);
    sync();
  };

  const startGame = () => {
    isAttractRef.current = false;
    setIsAttract(false);
    attractTimerRef.current = 0;
    idleTimerRef.current = 0;
    levelTransitionTimerRef.current = 0;
    setLevelCountdown(5);
    gameRef.current = createInitialGame(1);
    gameRef.current = { ...gameRef.current, status: "ready", message: "Premi una freccia o WASD per iniziare" };
    sync();
  };

  const submitScore = () => {
    if (initials.length === 3) {
      const updated = addHighScore(highScores, {
        initials: initials.toUpperCase(),
        score: hud.score,
        level: hud.level,
      });
      setHighScores(updated);
      // After entering initials, return to attract mode
      returnToAttract();
    }
  };

  // â”€â”€ Attract mode cycle (uses refs, timer-based) â”€â”€
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isAttractRef.current) return;
      
      attractTimerRef.current += 100;
      const t = attractTimerRef.current;
      const phase = attractPhaseRef.current;

      if (phase === "splash" && t >= SPLASH_DURATION) {
        attractPhaseRef.current = "demo";
        setAttractPhase("demo");
        attractTimerRef.current = 0;
        // Init demo game
        gameRef.current = createInitialGame(1);
        gameRef.current = { ...gameRef.current, status: "playing", message: "" };
        aiState = { phase: "border", targetX: 0, targetY: 0, moveTimer: 0, dirChangeTimer: 0, currentDir: { x: 1, y: 0 }, drawDepth: 0 };
        sync();
      } else if (phase === "demo" && t >= DEMO_DURATION) {
        attractPhaseRef.current = "attractScores";
        setAttractPhase("attractScores");
        attractTimerRef.current = 0;
      } else if (phase === "attractScores" && t >= SCORES_DURATION) {
        attractPhaseRef.current = "splash";
        setAttractPhase("splash");
        attractTimerRef.current = 0;
        gameRef.current = createInitialGame(1);
        sync();
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Insert coin blink (always active for arcade feel)
  useEffect(() => {
    const blink = setInterval(() => setInsertCoinBlink((prev) => !prev), 500);
    return () => clearInterval(blink);
  }, []);

  // â”€â”€ Main game loop â”€â”€
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawGame(ctx, gameRef.current);
    const timer = window.setInterval(() => {
      const phase = attractPhaseRef.current;
      if (isAttractRef.current && phase === "demo") {
        gameRef.current = stepDemoGame(gameRef.current);
        if (gameRef.current.status !== "playing") {
          gameRef.current = createInitialGame(1);
          gameRef.current = { ...gameRef.current, status: "playing", message: "" };
          aiState = { phase: "border", targetX: 0, targetY: 0, moveTimer: 0, dirChangeTimer: 0, currentDir: { x: 1, y: 0 }, drawDepth: 0 };
        }
      } else if (!isAttractRef.current) {
        gameRef.current = stepGame(gameRef.current);
        // Auto-advance after completing a level: 5s "Get Ready" countdown.
        const st = gameRef.current.status;
        if (st === "won") {
          levelTransitionTimerRef.current += TICK_MS;
          const remaining = Math.max(1, Math.ceil((LEVEL_COMPLETE_DURATION - levelTransitionTimerRef.current) / 1000));
          setLevelCountdown(remaining);
          if (levelTransitionTimerRef.current >= LEVEL_COMPLETE_DURATION) {
            const nextLevel = gameRef.current.level + 1;
            const score = gameRef.current.score;
            gameRef.current = createInitialGame(nextLevel, score);
            gameRef.current = { ...gameRef.current, status: "playing", message: "" };
            levelTransitionTimerRef.current = 0;
            setLevelCountdown(5);
          }
        } else {
          levelTransitionTimerRef.current = 0;
          setLevelCountdown(5);
        }

        // Auto-return to attract if idle on game over for 15s.
        if (st === "lost") {
          idleTimerRef.current += TICK_MS;
          if (idleTimerRef.current >= 15000) {
            returnToAttract();
          }
        } else {
          idleTimerRef.current = 0;
        }
      }
      drawGame(ctx, gameRef.current);
      setHud({ ...gameRef.current });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // â”€â”€ Input Helper: Recompute direction from still-pressed keys â”€â”€
  const keysPressed = useRef<Set<string>>(new Set());

  const recomputeDirection = () => {
    let newDir = { x: 0, y: 0 };
    for (const code of keysPressed.current) {
      const d = DIRS[code];
      if (d) {
        newDir = { x: newDir.x + d.x, y: newDir.y + d.y };
      }
    }
    // Normalize cardinal
    if (newDir.x !== 0) newDir.x = newDir.x > 0 ? 1 : -1;
    if (newDir.y !== 0) newDir.y = newDir.y > 0 ? 1 : -1;
    // Only allow cardinal movement
    if (newDir.x !== 0 && newDir.y !== 0) {
      newDir = { x: 0, y: 0 };
    }
    gameRef.current = updatePlayerState(gameRef.current, { dir: newDir });
    sync();
  };

  // â”€â”€ Keyboard handler â”€â”€
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Attract mode: any key starts game
      if (isAttractRef.current) {
        startGame();
        return;
      }

      // Any key resets idle timer
      idleTimerRef.current = 0;

      // Handle initials entry
      if (hud.status === "enterName") {
        if (event.code === "Enter") {
          submitScore();
          return;
        }
        if (event.code === "Backspace") {
          setInitials((prev) => prev.slice(0, -1));
          return;
        }
        if (event.key.length === 1 && /[a-zA-Z]/.test(event.key)) {
          setInitials((prev) => {
            const next = prev.length >= 3 ? event.key.toUpperCase() : prev + event.key.toUpperCase();
            if (next.length === 3) {
              // Auto-submit after 3 letters in keyboard mode
              setTimeout(() => {
                const updated = addHighScore(loadHighScores(), {
                  initials: next,
                  score: gameRef.current.score,
                  level: gameRef.current.level,
                });
                setHighScores(updated);
                returnToAttract();
              }, 200);
            }
            return next;
          });
          return;
        }
        return;
      }

      // Allow restart with R from lost/won states â†’ return to attract
      if (event.code === "KeyR" && (hud.status === "lost" || hud.status === "won")) {
        returnToAttract();
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        gameRef.current = updatePlayerState(gameRef.current, { spaceHeld: true });
        sync();
        return;
      }

      if (event.code === "KeyP") {
        event.preventDefault();
        const status = hud.status;
        if (status === "paused" || status === "ready") {
          gameRef.current = { ...gameRef.current, status: "playing", message: "" };
        } else if (status === "playing") {
          gameRef.current = { ...gameRef.current, status: "paused", message: "In pausa. Premi P per continuare" };
        }
        sync();
        return;
      }

      const dir = DIRS[event.code];
      if (dir) {
        event.preventDefault();
        keysPressed.current.add(event.code);
        const status = hud.status;
        if (status === "ready" || status === "paused") {
          gameRef.current = updatePlayerState(
            { ...gameRef.current, status: "playing", message: "" },
            { dir }
          );
        } else if (status === "playing") {
          gameRef.current = updatePlayerState(gameRef.current, { dir });
        }
        sync();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        gameRef.current = updatePlayerState(gameRef.current, { spaceHeld: false });
        sync();
        return;
      }
      keysPressed.current.delete(event.code);
      recomputeDirection();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [hud.status, initials]);

  const statusText = hud.status === "won" ? "VITTORIA!" : hud.status === "lost" ? "GAME OVER" : hud.status === "paused" ? "PAUSA" : hud.status === "enterName" ? "INSERISCI INIZIALI" : hud.status === "ready" ? "PRONTO" : "IN GIOCO";

  return (
    <main className="arcade-root flex items-stretch justify-center bg-black">
      {/* Arcade Cabinet Frame */}
      <div className={`arcade-shell relative flex w-full flex-col overflow-hidden ${!isAttract ? "p-0" : "max-w-5xl mx-auto"}`}>
        {/* Cabinet top marquee */}
        {isAttract && (
          <div className="relative overflow-hidden rounded-t-2xl border-2 border-b-0 border-[#00ff41] bg-gradient-to-b from-[#0a1a0a] to-black px-4 py-3 text-center">
            <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,255,65,0.03)_0px,rgba(0,255,65,0.03)_1px,transparent_1px,transparent_3px)] pointer-events-none" />
            <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-[#00ff41]/60">â˜… Taito-inspired Arcade â˜…</p>
            <h1 className="font-mono text-3xl font-black tracking-tight text-[#00ff41] neon-text sm:text-5xl marquee-glow">
              QIX
            </h1>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-[#00ff41]/50">Territory Conquest</p>
          </div>
        )}

        {/* Screen area with CRT effects */}
        <div className={`relative flex min-h-0 flex-1 flex-col overflow-hidden border-[#00ff41] bg-black ${isAttract ? "crt-curve border-x-2" : "border-0"} crt-scanlines crt-flicker`}>
          {/* HUD bar */}
          <div className="arcade-hud flex flex-wrap items-center justify-between border-b border-[#00ff41]/30 bg-black/80 px-2 py-1 font-mono text-[#00ff41] sm:px-3">
            <span className="flex items-center gap-1">
              <span className="text-[#00ff41]/60">LVL</span>
              <span className="hud-value font-black text-white">{hud.level}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[#00ff41]/60">SCORE</span>
              <span className="hud-value font-black text-white">{hud.score.toString().padStart(7, "0")}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[#00ff41]/60">AREA</span>
              <span className="hud-value font-black text-white">{hud.percent}%</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[#00ff41]/60">{"\u2665"}</span>
              <span className="hud-value font-black text-[#00ffff]">{hud.lives}</span>
            </span>
            <span className={`hud-value font-black ${hud.status === "playing" ? "text-[#00ff41]" : hud.status === "won" ? "text-yellow-400" : hud.status === "lost" ? "text-red-500" : "text-[#ff8c00]"}`}>
              {statusText}
            </span>
          </div>

          {/* Game canvas */}
          <div className="game-screen-box relative">
            <canvas
              ref={canvasRef}
              width={COLS * CELL}
              height={ROWS * CELL}
              style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' }}
              aria-label="Gioco arcade QIX"
            />
            {/* Message overlay */}
            {hud.message && hud.status !== "enterName" && hud.status !== "won" && !isAttract && (
              <div className="arcade-popup absolute inset-x-0 top-1/2 mx-auto -translate-y-1/2 border border-[#00ff41]/60 bg-black/90 text-center font-mono uppercase tracking-widest text-[#00ff41] shadow-[0_0_30px_rgba(0,255,65,0.4)]">
                {hud.message}
              </div>
            )}

            {/* Level complete countdown */}
            {hud.status === "won" && !isAttract && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="arcade-popup border-2 border-yellow-400 bg-black text-center font-mono shadow-[0_0_40px_rgba(250,204,21,0.45)]">
                  <h2 className="mb-3 text-[clamp(0.9rem,4vw,1.8rem)] font-black uppercase tracking-widest text-yellow-400">
                    Livello Completato
                  </h2>
                  <p className="mb-4 text-[clamp(0.7rem,3vw,1.125rem)] font-black uppercase tracking-widest text-[#00ff41]">Get Ready !</p>
                  <div className="mx-auto flex h-12 w-12 items-center justify-center border-2 border-[#00ff41] text-[clamp(1.4rem,6vw,2.25rem)] font-black text-white shadow-[0_0_24px_rgba(0,255,65,0.35)] sm:h-16 sm:w-16">
                    {levelCountdown}
                  </div>
                </div>
              </div>
            )}

            {/* Attract Mode: Splash Screen */}
            {isAttract && attractPhase === "splash" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-4 text-center" onPointerDown={startGame}>
                <h1 className="arcade-splash-title mb-3 font-mono font-black tracking-tight text-[#00ff41] neon-text">
                  QIX
                </h1>
                <p className="arcade-splash-subtitle mb-6 font-mono uppercase text-[#00ff41]/60">Territory Conquest</p>
                <p className={`arcade-insert-coin font-mono font-black uppercase text-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.5)] transition-opacity duration-200 ${insertCoinBlink ? "opacity-100" : "opacity-0"}`}>
                  INSERT COIN
                </p>
                <p className="mt-5 font-mono text-[clamp(0.42rem,2vw,0.65rem)] uppercase tracking-widest text-[#00ff41]/30">
                  Premi un tasto
                </p>
              </div>
            )}

            {/* Attract Mode: Demo label */}
            {isAttract && attractPhase === "demo" && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 font-mono text-xs uppercase tracking-widest text-[#00ff41]/40">
                â˜… DEMO PLAY â˜…
              </div>
            )}

            {/* Attract Mode: High Scores */}
            {isAttract && attractPhase === "attractScores" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/90">
                <div className="arcade-popup border-2 border-[#00ff41] bg-black font-mono shadow-[0_0_40px_rgba(0,255,65,0.5)]">
                  <h2 className="mb-3 text-center text-[clamp(0.8rem,3vw,1.25rem)] font-black text-[#00ff41]">HIGH SCORES</h2>
                  <table className="w-full text-[clamp(0.42rem,1.7vw,0.75rem)]">
                    <thead>
                      <tr className="text-[#00ff41]/60">
                        <th className="pb-2 text-left">#</th>
                        <th className="pb-2 text-left">NOME</th>
                        <th className="pb-2 text-right">SCORE</th>
                        <th className="pb-2 text-right">LVL</th>
                      </tr>
                    </thead>
                    <tbody className="text-[#00ff41]">
                      {highScores.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-[#00ff41]/40">
                            Nessun punteggio
                          </td>
                        </tr>
                      ) : (
                        highScores.map((score, i) => (
                          <tr key={i} className={i === 0 ? "text-yellow-400" : i === 1 ? "text-gray-300" : i === 2 ? "text-amber-600" : ""}>
                            <td className="py-1">{i + 1}</td>
                            <td className="py-1">{score.initials}</td>
                            <td className="py-1 text-right">{score.score.toString().padStart(7, "0")}</td>
                            <td className="py-1 text-right">{score.level}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  <p className={`mt-3 text-center text-[clamp(0.5rem,2vw,0.75rem)] font-black uppercase tracking-widest text-yellow-400 transition-opacity duration-200 ${insertCoinBlink ? "opacity-100" : "opacity-0"}`}>
                    INSERT COIN
                  </p>
                </div>
              </div>
            )}

            {/* Enter Name overlay (keyboard only) */}
            {hud.status === "enterName" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-2">
                <div className="arcade-popup border-2 border-[#00ff41] bg-black text-center font-mono shadow-[0_0_40px_rgba(0,255,65,0.5)]">
                  <h2 className="mb-2 text-[clamp(0.9rem,2.4vw,1.5rem)] font-black text-[#00ff41]">GAME OVER</h2>
                  <p className="mb-1 text-[clamp(0.48rem,1.4vw,0.8rem)] text-[#00ff41]/70">Punteggio: {hud.score.toString().padStart(7, "0")}</p>
                  <p className="mb-2 text-[clamp(0.48rem,1.4vw,0.8rem)] text-[#00ff41]/70">Livello: {hud.level}</p>
                  <p className="mb-3 text-[clamp(0.42rem,1.2vw,0.65rem)] uppercase tracking-widest text-[#00ff41]/60">Inserisci le iniziali</p>
                  <div className="mb-3 flex justify-center gap-3">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={`flex h-12 w-12 items-center justify-center border-2 text-2xl font-black ${
                          initials.length === i ? "border-[#00ff41] text-[#00ff41] bg-[#00ff41]/10 animate-pulse" : "border-[#00ff41]/40 text-[#00ff41]/60 bg-black"
                        }`}
                      >
                        {initials[i] || "_"}
                      </div>
                    ))}
                  </div>
                  <p className="text-[clamp(0.42rem,1.2vw,0.65rem)] uppercase tracking-widest text-[#00ff41]/40">
                    Digita 3 lettere sulla tastiera
                  </p>
                </div>
              </div>
            )}

            
          </div>
        </div>

      </div>
    </main>
  );
}

