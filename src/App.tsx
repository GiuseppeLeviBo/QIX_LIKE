import { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };
type GameStatus = "ready" | "playing" | "paused" | "won" | "lost" | "enterName" | "splash" | "demo" | "attractScores";
type Game = ReturnType<typeof createInitialGame>;

const SPLASH_DURATION = 10000;
const DEMO_DURATION = 20000;
const SCORES_DURATION = 10000;
const LEVEL_COMPLETE_DURATION = 5000;

type HighScore = {
  initials: string;
  score: number;
  level: number;
};

const HIGH_SCORES_KEY = "qix_high_scores";
const MAX_HIGH_SCORES = 10;

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

const COLS = 88;
const ROWS = 60;
const CELL = 10;
const TICK_MS = 52;
const TARGET_PERCENT = 75;
const START_LIVES = 3;
const MAX_SPARKS = 6;
const BASE_QIX_SPEED = 0.65;
const BASE_SPARK_SPEED = 0.45;

type Spark = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  progress: number;
  // Track distance along a perimeter for coordinated movement
  perimeterIndex: number;
};
const DIRS: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyD: { x: 1, y: 0 },
};
const CARDINALS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function key(x: number, y: number) {
  return `${x},${y}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createClaimed() {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(false) as boolean[]);
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      grid[y][x] = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
    }
  }
  return grid;
}

function copyClaimed(grid: boolean[][]) {
  return grid.map((row) => [...row]);
}

function areaPercent(grid: boolean[][]) {
  let claimed = 0;
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (grid[y][x]) claimed += 1;
    }
  }
  return Math.floor((claimed / (COLS * ROWS)) * 100);
}

function resetQix(level: number) {
  const angle = Math.random() * Math.PI * 2;
  // Make speed moderate but scaling
  const speed = BASE_QIX_SPEED + level * 0.1;
  return {
    x: COLS * 0.5,
    y: ROWS * 0.5,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    phase: Math.random() * Math.PI * 2,
  };
}

function isBorderCell(x: number, y: number, claimed: boolean[][]) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
  if (!claimed[y][x]) return false;
  
  // Check all 8 neighbors (orthogonal and diagonal) to ensure corners connect!
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !claimed[ny][nx]) {
        return true;
      }
    }
  }
  return false;
}

function findNearestOpenCell(startX: number, startY: number, claimed: boolean[][]): Point {
  const sx = clamp(Math.round(startX), 1, COLS - 2);
  const sy = clamp(Math.round(startY), 1, ROWS - 2);
  if (!claimed[sy][sx]) return { x: sx, y: sy };

  const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false) as boolean[]);
  const queue: Point[] = [{ x: sx, y: sy }];
  seen[sy][sx] = true;
  for (let i = 0; i < queue.length; i += 1) {
    const p = queue[i];
    for (const d of CARDINALS) {
      const nx = p.x + d.x;
      const ny = p.y + d.y;
      if (nx <= 0 || ny <= 0 || nx >= COLS - 1 || ny >= ROWS - 1 || seen[ny][nx]) continue;
      if (!claimed[ny][nx]) return { x: nx, y: ny };
      seen[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }
  return { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };
}

function buildBorderDistanceMap(claimed: boolean[][], target: Point) {
  if (!isBorderCell(target.x, target.y, claimed)) return null;
  const distances = Array.from({ length: ROWS }, () => Array(COLS).fill(Infinity) as number[]);
  const queue: Point[] = [{ ...target }];
  distances[target.y][target.x] = 0;

  for (let i = 0; i < queue.length; i += 1) {
    const p = queue[i];
    for (const d of CARDINALS) {
      const nx = p.x + d.x;
      const ny = p.y + d.y;
      if (!isBorderCell(nx, ny, claimed) || distances[ny][nx] !== Infinity) continue;
      distances[ny][nx] = distances[p.y][p.x] + 1;
      queue.push({ x: nx, y: ny });
    }
  }

  return distances;
}

function createSparks(level: number): Spark[] {
  const count = Math.min(2 + Math.floor(level / 2), MAX_SPARKS);
  const speed = BASE_SPARK_SPEED + level * 0.12;
  const sparks: Spark[] = [];
  
  // Place sparks on valid border cells, not the dead corner pixels.
  const spawnPoints = [
    { x: Math.floor(COLS * 0.25), y: 0, dx: 1, dy: 0 },
    { x: COLS - 1, y: Math.floor(ROWS * 0.3), dx: 0, dy: 1 },
    { x: Math.floor(COLS * 0.75), y: ROWS - 1, dx: -1, dy: 0 },
    { x: 0, y: Math.floor(ROWS * 0.7), dx: 0, dy: -1 },
    { x: Math.floor(COLS / 2), y: 0, dx: 1, dy: 0 },
    { x: Math.floor(COLS / 2), y: ROWS - 1, dx: -1, dy: 0 },
  ];

  for (let i = 0; i < count; i++) {
    const pt = spawnPoints[i % spawnPoints.length];
    sparks.push({
      x: pt.x,
      y: pt.y,
      dx: pt.dx,
      dy: pt.dy,
      speed,
      progress: 0,
      perimeterIndex: i * 10,
    });
  }
  return sparks;
}

function updateSpark(spark: Spark, claimed: boolean[][], distanceMap: number[][] | null): Spark {
  let progress = spark.progress + spark.speed;
  let sx = spark.x;
  let sy = spark.y;
  let dx = spark.dx;
  let dy = spark.dy;

  // Recover if our cell is no longer a valid border
  if (!isBorderCell(sx, sy, claimed)) {
    const fallback = findNearestBorderCell(sx, sy, claimed);
    sx = fallback.x;
    sy = fallback.y;
    const firstValid = CARDINALS.find((d) => isBorderCell(sx + d.x, sy + d.y, claimed));
    if (firstValid) {
      dx = firstValid.x;
      dy = firstValid.y;
    }
  }

  while (progress >= 1) {
    progress -= 1;

    // Get all valid neighboring border cells
    const neighbors = CARDINALS.map((d) => ({
      d,
      x: sx + d.x,
      y: sy + d.y,
    })).filter((n) => isBorderCell(n.x, n.y, claimed));

    if (neighbors.length === 0) break;

    // If chasing player, try to move toward them
    const chasing = distanceMap && distanceMap[sy]?.[sx] !== Infinity;
    if (chasing) {
      const withDist = neighbors.map((n) => ({
        ...n,
        dist: distanceMap![n.y][n.x],
      })).filter((n) => n.dist !== Infinity);

      if (withDist.length > 0) {
        withDist.sort((a, b) => a.dist - b.dist);
        dx = withDist[0].d.x;
        dy = withDist[0].d.y;
        sx += dx;
        sy += dy;
        continue;
      }
    }

    // Otherwise, pick a random valid direction (but avoid reversing when possible)
    const opposite = { x: -dx, y: -dy };
    const nonReverse = neighbors.filter((n) => n.d.x !== opposite.x || n.d.y !== opposite.y);
    const pool = nonReverse.length > 0 ? nonReverse : neighbors;
    const choice = pool[Math.floor(Math.random() * pool.length)];

    dx = choice.d.x;
    dy = choice.d.y;
    sx = choice.x;
    sy = choice.y;
  }

  return { ...spark, x: sx, y: sy, dx, dy, progress };
}

function findNearestBorderCell(startX: number, startY: number, claimed: boolean[][]): Point {
  const sx = clamp(Math.round(startX), 0, COLS - 1);
  const sy = clamp(Math.round(startY), 0, ROWS - 1);
  if (isBorderCell(sx, sy, claimed)) return { x: sx, y: sy };

  const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false) as boolean[]);
  const queue: Point[] = [{ x: sx, y: sy }];
  seen[sy][sx] = true;
  for (let i = 0; i < queue.length; i += 1) {
    const p = queue[i];
    for (const d of CARDINALS) {
      const nx = p.x + d.x;
      const ny = p.y + d.y;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || seen[ny][nx]) continue;
      if (isBorderCell(nx, ny, claimed)) return { x: nx, y: ny };
      seen[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }
  return { x: Math.floor(COLS / 2), y: ROWS - 1 };
}

function createInitialGame(level = 1, carryOverScore = 0) {
  const claimed = createClaimed();
  return {
    claimed,
    player: { x: Math.floor(COLS / 2), y: ROWS - 1 },
    dir: { x: 0, y: 0 },
    drawing: false,
    trail: [] as Point[],
    trailSet: new Set<string>(),
    qix: resetQix(level),
    sparks: createSparks(level),
    score: carryOverScore,
    percent: areaPercent(claimed),
    lives: START_LIVES,
    level,
    status: "ready" as GameStatus,
    message: `Livello ${level} — Premi una freccia o WASD per iniziare`,
    fuseIndex: 0,
    fuseTimer: 0,
    slowMode: false,
    slowClaimed: new Set<string>(),
    slowTick: 0,
    spaceHeld: false,
  };
}



function loseLife(game: Game, text: string): Game {
  const lives = game.lives - 1;
  // Spawn explosion at player position
  spawnExplosion(game.player.x * CELL + CELL / 2, game.player.y * CELL + CELL / 2, "#00ffff", 30);
  spawnExplosion(game.player.x * CELL + CELL / 2, game.player.y * CELL + CELL / 2, "#ffff00", 15);
  
  if (lives <= 0) {
    return {
      ...game,
      player: { x: Math.floor(COLS / 2), y: ROWS - 1 },
      dir: { x: 0, y: 0 },
      drawing: false,
      trail: [],
      trailSet: new Set<string>(),
      qix: resetQix(game.level),
      sparks: createSparks(game.level),
      lives: 0,
      status: "enterName",
      message: "GAME OVER — Inserisci le tue iniziali",
      fuseIndex: 0,
      fuseTimer: 0,
      slowMode: false,
      slowClaimed: new Set<string>(),
      slowTick: 0,
      spaceHeld: false,
    };
  }
  
  return {
    ...game,
    player: { x: Math.floor(COLS / 2), y: ROWS - 1 },
    dir: { x: 0, y: 0 },
    drawing: false,
    trail: [],
    trailSet: new Set<string>(),
    qix: resetQix(game.level),
    sparks: createSparks(game.level),
    lives,
    status: "paused",
    message: `${text} Premi P per pausa / SPAZIO per slow mode`,
    fuseIndex: 0,
    fuseTimer: 0,
    slowMode: false,
    slowClaimed: game.slowClaimed,
    slowTick: 0,
    spaceHeld: false,
  };
}

function claimClosedArea(game: Game): Game {
  const claimed = copyClaimed(game.claimed);
  for (const p of game.trail) claimed[p.y][p.x] = true;

  const qixOpenCell = findNearestOpenCell(game.qix.x, game.qix.y, claimed);
  const qx = qixOpenCell.x;
  const qy = qixOpenCell.y;
  const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false) as boolean[]);
  const queue: Point[] = [];
  if (!claimed[qy][qx]) {
    seen[qy][qx] = true;
    queue.push({ x: qx, y: qy });
  }

  // The enemy marks the unsafe region; every other enclosed cell becomes territory.
  for (let i = 0; i < queue.length; i += 1) {
    const p = queue[i];
    for (const d of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const nx = p.x + d.x;
      const ny = p.y + d.y;
      if (nx <= 0 || ny <= 0 || nx >= COLS - 1 || ny >= ROWS - 1) continue;
      if (!seen[ny][nx] && !claimed[ny][nx]) {
        seen[ny][nx] = true;
        queue.push({ x: nx, y: ny });
      }
    }
  }

  let gained = 0;
  for (let y = 1; y < ROWS - 1; y += 1) {
    for (let x = 1; x < COLS - 1; x += 1) {
      if (!claimed[y][x] && !seen[y][x]) {
        claimed[y][x] = true;
        gained += 1;
      }
    }
  }

  const destroyedSparks = game.sparks.filter((spark) => !isBorderCell(spark.x, spark.y, claimed));
  const survivingSparks = game.sparks.filter((spark) => isBorderCell(spark.x, spark.y, claimed));
  for (const spark of destroyedSparks) {
    spawnExplosion(spark.x * CELL + CELL / 2, spark.y * CELL + CELL / 2, "#ff8c00", 26);
    spawnExplosion(spark.x * CELL + CELL / 2, spark.y * CELL + CELL / 2, "#ffff00", 14);
  }

  const percent = areaPercent(claimed);
  const sparkBonus = destroyedSparks.length * (2500 + game.level * 500);
  const areaPoints = gained * 12 + game.trail.length * 5;
  const score = game.score + (game.slowMode ? areaPoints * 2 : areaPoints) + sparkBonus;
  
  // Track slow-claimed cells
  const newSlowClaimed = new Set(game.slowClaimed);
  if (game.slowMode) {
    for (let y = 1; y < ROWS - 1; y += 1) {
      for (let x = 1; x < COLS - 1; x += 1) {
        if (!game.claimed[y][x] && claimed[y][x]) {
          newSlowClaimed.add(key(x, y));
        }
      }
    }
  }
  const won = percent >= TARGET_PERCENT;

  // Celebration fireworks on level win
  if (won) {
    const colors = ["#00ff41", "#ffff00", "#00ffff", "#ff00ff", "#ff8c00"];
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        spawnExplosion(
          Math.random() * COLS * CELL,
          Math.random() * ROWS * CELL,
          colors[i % colors.length],
          20
        );
      }, i * 80);
    }
  }

  return {
    ...game,
    claimed,
    trail: [],
    trailSet: new Set<string>(),
    sparks: survivingSparks,
    drawing: false,
    percent,
    score,
    slowMode: false,
    slowClaimed: newSlowClaimed,
    slowTick: 0,
    spaceHeld: game.spaceHeld,
    status: won ? "won" : game.status,
    message: won ? "Livello Completato" : "",
  };
}

function stepGame(game: Game): Game {
  if (game.status !== "playing") return game;

  const nextQix = { ...game.qix, phase: game.qix.phase + 0.18 };
  const currentQixCell = { x: Math.round(nextQix.x), y: Math.round(nextQix.y) };
  if (game.claimed[currentQixCell.y]?.[currentQixCell.x]) {
    const open = findNearestOpenCell(nextQix.x, nextQix.y, game.claimed);
    nextQix.x = open.x;
    nextQix.y = open.y;
  }

  // ── STRICT QIX MOVEMENT ──
  // Make multiple small steps to ensure QIX never enters claimed territory
  const speed = BASE_QIX_SPEED + game.level * 0.1;
  const steps = 5;
  let qixHitTrailDuringMove = false;
  for (let s = 0; s < steps; s++) {
    const nx = nextQix.x + (nextQix.vx / steps);
    const ny = nextQix.y + (nextQix.vy / steps);
    
    const cx = Math.round(nx);
    const cy = Math.round(ny);

    if (game.trail.some((pt) => Math.hypot(nx - pt.x, ny - pt.y) < 1.35)) {
      qixHitTrailDuringMove = true;
      nextQix.x = nx;
      nextQix.y = ny;
      break;
    }

    // Bounds check
    const isOutOfBounds = cx <= 0 || cx >= COLS - 1 || cy <= 0 || cy >= ROWS - 1;
    // Claimed territory check
    const isClaimed = isOutOfBounds || game.claimed[cy]?.[cx] === true;

    if (isClaimed) {
      // Collision! Invert velocity components
      const claimX = game.claimed[Math.round(nextQix.y)]?.[cx] || cx <= 0 || cx >= COLS - 1;
      const claimY = game.claimed[cy]?.[Math.round(nextQix.x)] || cy <= 0 || cy >= ROWS - 1;

      if (claimX) nextQix.vx = -nextQix.vx;
      if (claimY) nextQix.vy = -nextQix.vy;
      
      // Add randomness to prevent getting trapped
      nextQix.vx += (Math.random() - 0.5) * 0.25;
      nextQix.vy += (Math.random() - 0.5) * 0.25;

      // Normalize speed
      const mag = Math.sqrt(nextQix.vx * nextQix.vx + nextQix.vy * nextQix.vy);
      if (mag > 0) {
        nextQix.vx = (nextQix.vx / mag) * speed;
        nextQix.vy = (nextQix.vy / mag) * speed;
      }
      break; // Re-evaluate on next frame
    } else {
      nextQix.x = nx;
      nextQix.y = ny;
    }
  }

  // ── UPDATE SPARKS ──
  const sparkTarget = !game.drawing && isBorderCell(game.player.x, game.player.y, game.claimed) ? game.player : null;
  const distanceMap = sparkTarget ? buildBorderDistanceMap(game.claimed, sparkTarget) : null;
  const updatedSparks = game.sparks.map((spark) => updateSpark(spark, game.claimed, distanceMap));

  let updated: Game = {
    ...game,
    qix: nextQix,
    sparks: updatedSparks,
  };

  // ── CHECK TRAIL COLLISIONS ──
  // Check if QIX overlaps with any cell in the trail (distance-based collision)
  const qixHitTrail = qixHitTrailDuringMove || game.trail.some((pt) => {
    const dx = nextQix.x - pt.x;
    const dy = nextQix.y - pt.y;
    return Math.sqrt(dx * dx + dy * dy) < 1.95;
  });

  if (qixHitTrail) {
    return loseLife(updated, "Il QIX ha tagliato la tua scia.");
  }

  const dir = updated.dir;

  // ── FUSE: burn trail when player stops while drawing ──
  if (updated.drawing && dir.x === 0 && dir.y === 0) {
    const newFuseTimer = updated.fuseTimer + 1;
    let newFuseIndex = updated.fuseIndex;
    
    if (newFuseTimer >= 3) {
      newFuseIndex = updated.fuseIndex + 1;
      updated = { ...updated, fuseTimer: 0, fuseIndex: newFuseIndex };
      
      // Spark at the fuse head
      if (newFuseIndex < updated.trail.length) {
        const fusePt = updated.trail[newFuseIndex];
        spawnExplosion(fusePt.x * CELL + CELL / 2, fusePt.y * CELL + CELL / 2, "#ff3700", 4);
      }
    } else {
      updated = { ...updated, fuseTimer: newFuseTimer };
    }
    
    if (updated.fuseIndex >= updated.trail.length) {
      return loseLife(updated, "La miccia ha raggiunto la tua penna.");
    }
    
    return updated;
  }

  // ── Player resumes moving: cancel fuse ──
  if (updated.drawing && updated.fuseIndex > 0) {
    updated = { ...updated, fuseIndex: 0, fuseTimer: 0 };
  }

  if (dir.x === 0 && dir.y === 0) return updated;

  const player = updated.player;
  const target = {
    x: clamp(player.x + dir.x, 0, COLS - 1),
    y: clamp(player.y + dir.y, 0, ROWS - 1),
  };

  if (target.x === player.x && target.y === player.y) return updated;

  const targetKey = key(target.x, target.y);
  const targetClaimed = updated.claimed[target.y][target.x];
  const targetTrail = updated.trailSet.has(targetKey);

  // ── SLOW MODE: when Space is held while drawing, move at half speed ──
  if (updated.drawing && updated.slowMode) {
    const newSlowTick = updated.slowTick + 1;
    if (newSlowTick % 2 !== 0) {
      // Skip movement this tick (half speed)
      return { ...updated, slowTick: newSlowTick };
    }
    updated = { ...updated, slowTick: newSlowTick };
  }

  if (updated.drawing) {
    if (targetTrail) return loseLife(updated, "Hai incrociato la tua scia.");
    if (targetClaimed) {
      updated = { ...updated, player: target };
      return claimClosedArea(updated);
    }
    const trailSet = new Set(updated.trailSet);
    trailSet.add(targetKey);
    updated = { ...updated, player: target, trail: [...updated.trail, target], trailSet };
  } else if (targetClaimed) {
    updated = { ...updated, player: target };
  } else {
    // Starting to draw: check if Space is held for slow mode
    const startSlow = updated.spaceHeld;
    const trailSet = new Set<string>([targetKey]);
    updated = { ...updated, drawing: true, player: target, trail: [target], trailSet, slowMode: startSlow, slowTick: 0 };
  }

  // Hit between player and QIX
  const playerHitQix = Math.abs(nextQix.x - updated.player.x) < 1.6 && Math.abs(nextQix.y - updated.player.y) < 1.6;
  if (playerHitQix) {
    return loseLife(updated, "Il QIX ti ha colpito.");
  }

  // Hit between SPARKS and player or trail
  for (const spark of updated.sparks) {
    const isPlayerHitOnBorder = spark.x === updated.player.x && spark.y === updated.player.y && !updated.drawing;
    if (isPlayerHitOnBorder) {
      return loseLife(updated, "Uno Sparx ti ha raggiunto sul bordo.");
    }

    if (updated.drawing) {
      // Check if Spark is adjacent to or on any cell in the trail
      const isSparkHittingTrail = updated.trail.some(
        (pt) => Math.abs(spark.x - pt.x) <= 1 && Math.abs(spark.y - pt.y) <= 1
      );
      if (isSparkHittingTrail) {
        return loseLife(updated, "Uno Sparx ha colpito la tua scia.");
      }
    }
  }

  return updated;
}

// ── Demo AI: simple player that claims territory ──
let aiState: {
  phase: "border" | "drawing" | "returning";
  targetX: number;
  targetY: number;
  moveTimer: number;
  dirChangeTimer: number;
  currentDir: Point;
  drawDepth: number;
} = {
  phase: "border",
  targetX: 0,
  targetY: 0,
  moveTimer: 0,
  dirChangeTimer: 0,
  currentDir: { x: 1, y: 0 },
  drawDepth: 0,
};

function getAIDirection(game: Game): Point {
  const p = game.player;
  const qixX = Math.round(game.qix.x);
  const qixY = Math.round(game.qix.y);
  
  // Simple AI: move along border, occasionally venture inward
  if (game.drawing) {
    // If drawing, try to close the shape by heading back to border
    aiState.drawDepth++;
    
    // After going deep enough, head back to claimed territory
    if (aiState.drawDepth > 8 + Math.floor(Math.random() * 8)) {
      // Find nearest claimed cell direction
      const dirs = [
        { x: 0, y: -1 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 1, y: 0 },
      ];
      
      // Prefer direction toward border/claimed, avoid QIX
      const safe = dirs.filter((d) => {
        const nx = p.x + d.x;
        const ny = p.y + d.y;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return false;
        if (game.trailSet.has(key(nx, ny))) return false;
        const distToQix = Math.abs(nx - qixX) + Math.abs(ny - qixY);
        return distToQix > 5;
      });
      
      if (safe.length > 0) {
        // Prefer direction toward nearest claimed
        safe.sort((a, b) => {
          const distA = Math.min(
            a.x === 0 ? p.x : a.x === 1 ? COLS - 1 - p.x : 999,
            a.y === 0 ? p.y : a.y === 1 ? ROWS - 1 - p.y : 999
          );
          const distB = Math.min(
            b.x === 0 ? p.x : b.x === 1 ? COLS - 1 - p.x : 999,
            b.y === 0 ? p.y : b.y === 1 ? ROWS - 1 - p.y : 999
          );
          return distA - distB;
        });
        return safe[0];
      }
    }
    
    // Continue in current direction or turn
    const currentDir = aiState.currentDir;
    const nextX = p.x + currentDir.x;
    const nextY = p.y + currentDir.y;
    
    if (nextX > 0 && nextX < COLS - 1 && nextY > 0 && nextY < ROWS - 1 && 
        !game.claimed[nextY]?.[nextX] && !game.trailSet.has(key(nextX, nextY))) {
      return currentDir;
    }
    
    // Need to turn - pick a direction that continues into unclaimed
    const turns = [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ].filter((d) => {
      const nx = p.x + d.x;
      const ny = p.y + d.y;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return false;
      if (game.trailSet.has(key(nx, ny))) return false;
      const distToQix = Math.abs(nx - qixX) + Math.abs(ny - qixY);
      return distToQix > 5;
    });
    
    if (turns.length > 0) {
      const chosen = turns[Math.floor(Math.random() * turns.length)];
      aiState.currentDir = chosen;
      return chosen;
    }
    
    // Stuck, try to head to claimed
    return { x: 0, y: 1 };
  }
  
  // Not drawing - move along border/claimed territory
  aiState.drawDepth = 0;
  
  // Check if on border/claimed
  const onClaimed = game.claimed[p.y]?.[p.x];
  
  if (onClaimed) {
    // Randomly decide to venture inward
    if (Math.random() < 0.03) {
      // Find direction into unclaimed
      const inward = [
        { x: 0, y: -1 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 1, y: 0 },
      ].filter((d) => {
        const nx = p.x + d.x;
        const ny = p.y + d.y;
        if (nx <= 0 || ny <= 0 || nx >= COLS - 1 || ny >= ROWS - 1) return false;
        if (game.claimed[ny]?.[nx]) return false;
        const distToQix = Math.abs(nx - qixX) + Math.abs(ny - qixY);
        return distToQix > 8;
      });
      
      if (inward.length > 0) {
        const chosen = inward[Math.floor(Math.random() * inward.length)];
        aiState.currentDir = chosen;
        return chosen;
      }
    }
    
    // Move along claimed - prefer continuing current direction
    const nextX = p.x + aiState.currentDir.x;
    const nextY = p.y + aiState.currentDir.y;
    if (nextX >= 0 && nextX < COLS && nextY >= 0 && nextY < ROWS && game.claimed[nextY]?.[nextX]) {
      return aiState.currentDir;
    }
    
    // Pick a random claimed neighbor
    const claimedNeighbors = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ].filter((d) => {
      const nx = p.x + d.x;
      const ny = p.y + d.y;
      return nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && game.claimed[ny]?.[nx];
    });
    
    if (claimedNeighbors.length > 0) {
      const chosen = claimedNeighbors[Math.floor(Math.random() * claimedNeighbors.length)];
      aiState.currentDir = chosen;
      return chosen;
    }
  }
  
  return aiState.currentDir;
}

function stepDemoGame(game: Game): Game {
  // AI decides direction
  const aiDir = getAIDirection(game);
  const gameWithDir = { ...game, dir: aiDir };
  return stepGame(gameWithDir);
}

// ── Particle system for explosions ──
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

// ── Frame counter for animations ──
let frameCount = 0;

function drawGame(ctx: CanvasRenderingContext2D, game: Game) {
  frameCount++;
  const w = COLS * CELL;
  const h = ROWS * CELL;

  // ── Background: deep space with subtle starfield ──
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

  // ── Grid overlay (Tron-style) ──
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

  // ── Claimed territory with gradient fill ──
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
          // Deep blue claimed area with subtle animation
          const shade = Math.sin(frameCount * 0.03 + x * 0.15 + y * 0.15) * 15;
          const r = 10 + shade * 0.3;
          const g = 30 + shade * 0.5;
          const b = 120 + shade;
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
          // Subtle inner glow
          ctx.fillStyle = `rgba(0, 100, 255, 0.15)`;
          ctx.fillRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4);
        }
      }
    }
  }

  // ── Border glow effect ──
  ctx.shadowColor = "#00ff41";
  ctx.shadowBlur = 12;
  ctx.strokeStyle = "#00ff41";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  ctx.shadowBlur = 0;

  // ── Trail with gradient, glow, and burning fuse ──
  const trailLen = game.trail.length;
  for (let i = 0; i < trailLen; i++) {
    const p = game.trail[i];
    const t = i / Math.max(trailLen - 1, 1);
    const size = 4 + t * 6;
    const offset = (CELL - size) / 2;
    
    // Check if this segment has burned into a fuse
    const isFuse = game.fuseIndex > 0 && i <= game.fuseIndex;

    if (isFuse) {
      // Burning fuse segment (flashing red and orange)
      const isFlash = Math.floor(frameCount / 3) % 2 === 0;
      const fuseColor = isFlash ? "#ff3700" : "#ff9900";
      ctx.shadowColor = fuseColor;
      ctx.shadowBlur = 12;
      ctx.fillStyle = fuseColor;
      ctx.fillRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2);
    } else if (game.slowMode) {
      // Slow mode trail: red/orange glow
      const alpha = 0.4 + t * 0.6;
      ctx.shadowColor = "#ff3300";
      ctx.shadowBlur = 10 + t * 8;
      ctx.fillStyle = `rgba(255, 50, 0, ${alpha * 0.3})`;
      ctx.fillRect(p.x * CELL, p.y * CELL, CELL, CELL);

      // Core
      ctx.fillStyle = `rgba(255, 80, 20, ${alpha})`;
      ctx.fillRect(p.x * CELL + offset, p.y * CELL + offset, size, size);
    } else {
      // Normal yellow trail segment
      const alpha = 0.4 + t * 0.6;
      ctx.shadowColor = "#ffff00";
      ctx.shadowBlur = 10 + t * 8;
      ctx.fillStyle = `rgba(255, 255, 0, ${alpha * 0.3})`;
      ctx.fillRect(p.x * CELL, p.y * CELL, CELL, CELL);

      // Core
      ctx.fillStyle = `rgba(255, 255, 0, ${alpha})`;
      ctx.fillRect(p.x * CELL + offset, p.y * CELL + offset, size, size);
    }
  }
  ctx.shadowBlur = 0;

  // ── QIX: menacing plasma entity ──
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

  // ── Sparx: glowing spinning crosses ──
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

  // ── Player: arcade-style ship ──
  const px = game.player.x * CELL + CELL / 2;
  const py = game.player.y * CELL + CELL / 2;
  const playerColor = game.drawing ? (game.slowMode ? "#ff3300" : "#ffff00") : "#00ffff";
  const playerPulse = Math.sin(frameCount * 0.15) * 0.2 + 0.8;

  // Glow aura
  const playerAura = ctx.createRadialGradient(px, py, 0, px, py, CELL * 2);
  playerAura.addColorStop(0, `${playerColor}40`);
  playerAura.addColorStop(1, `${playerColor}00`);
  ctx.fillStyle = playerAura;
  ctx.fillRect(px - CELL * 2, py - CELL * 2, CELL * 4, CELL * 4);

  // Ship shape
  ctx.save();
  ctx.translate(px, py);

  // Determine rotation based on direction
  let angle = 0;
  if (game.dir.x === 1) angle = 0;
  else if (game.dir.x === -1) angle = Math.PI;
  else if (game.dir.y === -1) angle = -Math.PI / 2;
  else if (game.dir.y === 1) angle = Math.PI / 2;
  ctx.rotate(angle);

  ctx.shadowColor = playerColor;
  ctx.shadowBlur = 16;
  ctx.fillStyle = playerColor;

  // Arrow/ship shape
  ctx.beginPath();
  ctx.moveTo(CELL * 0.6, 0);
  ctx.lineTo(-CELL * 0.4, -CELL * 0.4);
  ctx.lineTo(-CELL * 0.2, 0);
  ctx.lineTo(-CELL * 0.4, CELL * 0.4);
  ctx.closePath();
  ctx.fill();

  // Engine glow
  ctx.fillStyle = game.drawing ? "#ff6600" : "#0088ff";
  ctx.shadowColor = game.drawing ? "#ff6600" : "#0088ff";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(-CELL * 0.25, 0, CELL * 0.15 * playerPulse, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.shadowBlur = 0;

  // ── Particles ──
  updateParticles();
  drawParticles(ctx);

  // ── CRT Scanlines overlay ──
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  for (let y = 0; y < h; y += 3) {
    ctx.fillRect(0, y, w, 1);
  }

  // ── Vignette ──
  const vignette = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.7);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  // ── HUD overlay on canvas ──
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(0, 255, 65, 0.9)";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`LVL ${game.level}`, 8, 16);
  ctx.textAlign = "center";
  ctx.fillText(`SCORE ${game.score.toString().padStart(7, "0")}`, w / 2, 16);
  ctx.textAlign = "right";
  ctx.fillText(`${game.percent}%/${TARGET_PERCENT}%`, w - 8, 16);

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

  const sync = () => setHud({ ...gameRef.current });

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

  // ── Attract mode cycle (uses refs, timer-based) ──
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

  // ── Main game loop ──
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

  // ── Keyboard handler ──
  const keysPressed = useRef<Set<string>>(new Set());

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
        if (event.code === "Enter" && initials.length === 3) {
          submitScore();
          return;
        }
        if (event.code === "Backspace") {
          setInitials((prev) => prev.slice(0, -1));
          return;
        }
        if (event.key.length === 1 && /[a-zA-Z]/.test(event.key) && initials.length < 3) {
          setInitials((prev) => prev + event.key.toUpperCase());
          return;
        }
        return;
      }

      // Allow restart with R from lost/won states → return to attract
      if (event.code === "KeyR" && (hud.status === "lost" || hud.status === "won")) {
        returnToAttract();
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        // Space = slow mode modifier while playing
        gameRef.current = { ...gameRef.current, spaceHeld: true };
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
          gameRef.current = { ...gameRef.current, status: "playing", message: "", dir };
        } else if (status === "playing") {
          gameRef.current = { ...gameRef.current, dir };
        }
        sync();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keysPressed.current.delete(event.code);
      
      // Clear spaceHeld when Space is released
      if (event.code === "Space") {
        gameRef.current = { ...gameRef.current, spaceHeld: false };
        sync();
        return;
      }
      
      // Recompute direction from still-pressed keys
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
        // Keep the last-pressed direction
        newDir = { x: 0, y: 0 };
      }
      gameRef.current = { ...gameRef.current, dir: newDir };
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
    <main className="flex min-h-screen items-center justify-center bg-black p-2 sm:p-4">
      {/* Arcade Cabinet Frame */}
      <div className="relative w-full max-w-5xl">
        {/* Cabinet top marquee */}
        <div className="relative overflow-hidden rounded-t-2xl border-2 border-b-0 border-[#00ff41] bg-gradient-to-b from-[#0a1a0a] to-black px-4 py-3 text-center">
          <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,255,65,0.03)_0px,rgba(0,255,65,0.03)_1px,transparent_1px,transparent_3px)] pointer-events-none" />
          <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-[#00ff41]/60">★ Taito-inspired Arcade ★</p>
          <h1 className="font-mono text-3xl font-black tracking-tight text-[#00ff41] neon-text sm:text-5xl marquee-glow">
            QIX
          </h1>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-[#00ff41]/50">Territory Conquest</p>
        </div>

        {/* Screen area with CRT effects */}
        <div className="relative crt-curve crt-scanlines crt-flicker overflow-hidden border-x-2 border-[#00ff41] bg-black">
          {/* HUD bar */}
          <div className="flex items-center justify-between border-b border-[#00ff41]/30 bg-black/80 px-3 py-1.5 font-mono text-xs text-[#00ff41] sm:text-sm">
            <span className="flex items-center gap-1">
              <span className="text-[#00ff41]/60">LVL</span>
              <span className="text-base font-black text-white">{hud.level}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[#00ff41]/60">SCORE</span>
              <span className="text-base font-black text-white">{hud.score.toString().padStart(7, "0")}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[#00ff41]/60">AREA</span>
              <span className="text-base font-black text-white">{hud.percent}%</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[#00ff41]/60">♥</span>
              <span className="text-base font-black text-[#00ffff]">{hud.lives}</span>
            </span>
            <span className={`text-base font-black ${hud.status === "playing" ? "text-[#00ff41]" : hud.status === "won" ? "text-yellow-400" : hud.status === "lost" ? "text-red-500" : "text-[#ff8c00]"}`}>
              {statusText}
            </span>
          </div>

          {/* Game canvas */}
          <div className="relative arcade-border">
            <canvas
              ref={canvasRef}
              width={COLS * CELL}
              height={ROWS * CELL}
              className="block h-auto w-full [image-rendering:pixelated]"
              aria-label="Gioco arcade QIX"
            />
            {/* Message overlay */}
            {hud.message && hud.status !== "enterName" && hud.status !== "won" && !isAttract && (
              <div className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 border border-[#00ff41]/60 bg-black/90 px-6 py-4 text-center font-mono text-sm uppercase tracking-widest text-[#00ff41] shadow-[0_0_30px_rgba(0,255,65,0.4)]">
                {hud.message}
              </div>
            )}

            {/* Level complete countdown */}
            {hud.status === "won" && !isAttract && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="border-2 border-yellow-400 bg-black px-8 py-6 text-center font-mono shadow-[0_0_40px_rgba(250,204,21,0.45)]">
                  <h2 className="mb-4 text-2xl font-black uppercase tracking-widest text-yellow-400 sm:text-3xl">
                    Livello Completato
                  </h2>
                  <p className="mb-5 text-lg font-black uppercase tracking-widest text-[#00ff41]">Get Ready !</p>
                  <div className="mx-auto flex h-16 w-16 items-center justify-center border-2 border-[#00ff41] text-4xl font-black text-white shadow-[0_0_24px_rgba(0,255,65,0.35)]">
                    {levelCountdown}
                  </div>
                </div>
              </div>
            )}

            {/* Attract Mode: Splash Screen */}
            {isAttract && attractPhase === "splash" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
                <h1 className="mb-4 font-mono text-5xl font-black tracking-tight text-[#00ff41] neon-text sm:text-7xl">
                  QIX
                </h1>
                <p className="mb-8 font-mono text-sm uppercase tracking-[0.4em] text-[#00ff41]/60">Territory Conquest</p>
                <p className={`font-mono text-xl font-black uppercase tracking-widest text-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.5)] transition-opacity duration-200 ${insertCoinBlink ? "opacity-100" : "opacity-0"}`}>
                  INSERT COIN
                </p>
                <p className="mt-6 font-mono text-[10px] uppercase tracking-widest text-[#00ff41]/30">
                  Premi un tasto per giocare
                </p>
              </div>
            )}

            {/* Attract Mode: Demo label */}
            {isAttract && attractPhase === "demo" && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 font-mono text-xs uppercase tracking-widest text-[#00ff41]/40">
                ★ DEMO PLAY ★
              </div>
            )}

            {/* Attract Mode: High Scores */}
            {isAttract && attractPhase === "attractScores" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/90">
                <div className="w-72 border-2 border-[#00ff41] bg-black p-4 font-mono shadow-[0_0_40px_rgba(0,255,65,0.5)]">
                  <h2 className="mb-4 text-center text-xl font-black text-[#00ff41]">HIGH SCORES</h2>
                  <table className="w-full text-xs">
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
                  <p className={`mt-4 text-center text-xs font-black uppercase tracking-widest text-yellow-400 transition-opacity duration-200 ${insertCoinBlink ? "opacity-100" : "opacity-0"}`}>
                    INSERT COIN
                  </p>
                </div>
              </div>
            )}

            {/* Enter Name overlay */}
            {hud.status === "enterName" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/85">
                <div className="border-2 border-[#00ff41] bg-black p-6 text-center font-mono shadow-[0_0_40px_rgba(0,255,65,0.5)]">
                  <h2 className="mb-4 text-2xl font-black text-[#00ff41]">GAME OVER</h2>
                  <p className="mb-2 text-sm text-[#00ff41]/70">Punteggio: {hud.score.toString().padStart(7, "0")}</p>
                  <p className="mb-4 text-sm text-[#00ff41]/70">Livello: {hud.level}</p>
                  <p className="mb-3 text-xs uppercase tracking-widest text-[#00ff41]/60">Inserisci le tue iniziali</p>
                  <div className="mb-4 flex justify-center gap-2">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={`flex h-10 w-10 items-center justify-center border-2 text-2xl font-black ${
                          initials.length === i ? "border-[#00ff41] text-[#00ff41]" : "border-[#00ff41]/40 text-[#00ff41]/60"
                        }`}
                      >
                        {initials[i] || "_"}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] uppercase tracking-widest text-[#00ff41]/40">
                    {initials.length < 3 ? "Premi 3 lettere..." : "Premi INVIO per confermare"}
                  </p>
                </div>
              </div>
            )}

            
          </div>
        </div>

        {/* Cabinet bottom with controls info */}
        <div className="overflow-hidden rounded-b-2xl border-2 border-t-0 border-[#00ff41] bg-gradient-to-b from-black to-[#0a1a0a] px-4 py-3">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 font-mono text-[10px] uppercase tracking-widest text-[#00ff41]/50 sm:text-xs">
            <span>↑↓←→ / WASD: Muovi</span>
            <span>SPAZIO: Slow Mode (x2 punti)</span>
            <span>P: Pausa</span>
            <span>R: Torna al menu</span>
          </div>
        </div>
      </div>
    </main>
  );
}