import { useEffect, useRef, useState } from "react";
import {
  TICK_MS, TARGET_PERCENT, START_LIVES, COLS, ROWS, CELL_PX as CELL,
  ATTRACT_SPLASH_MS as SPLASH_DURATION, ATTRACT_DEMO_MS as DEMO_DURATION,
  ATTRACT_SCORES_MS as SCORES_DURATION, LEVEL_COMPLETE_DURATION_MS as LEVEL_COMPLETE_DURATION,
  BASE_QIX_SPEED, BASE_SPARK_SPEED, QIX_SPEED_PER_LEVEL, SPARK_SPEED_PER_LEVEL, MAX_SPARKS,
  IDLE_NODRAW_THRESHOLD_TICKS, EXTRA_SPAWN_SPARKS_LIMIT,
  ITEM_SPAWN_INTERVAL_TICKS, ITEM_SPAWN_CHANCE, MAX_ITEMS_ON_SCREEN, ITEM_LIFETIME_TICKS,
  WEIGHT_SHIELD, WEIGHT_ROCKET, WEIGHT_ONE_UP, WEIGHT_SLOW,
  WEIGHT_FAST_MONSTER, WEIGHT_BOMB,
  SHIELD_DURATION_MS, ROCKET_DURATION_MS, SLOW_DURATION_MS, FAST_MONSTER_DURATION_MS,
  ROCKET_SPEED_MULTIPLIER, SLOW_SPEED_MULTIPLIER, FAST_MONSTER_SPEED_MULTIPLIER,
  POINTS_PER_AREA_CELL, POINTS_PER_TRAIL_CELL,
  POINTS_PER_SPARK_DESTROYED_BASE, POINTS_PER_SPARK_DESTROYED_PER_LEVEL, POINTS_COINS_PICKUP,
  SLOW_AREA_POINTS_MULTIPLIER,
  BOMB_EXPLOSION_RADIUS_CELLS, BOMB_KILL_DISTANCE_CELLS, FUSE_ADVANCE_TICKS,
  TOTAL_ITEM_WEIGHT,
} from "./config/gameplayConstants";

type Point = { x: number; y: number };
type GameStatus = "ready" | "playing" | "paused" | "won" | "lost" | "enterName" | "splash" | "demo" | "attractScores";

type FloatingText = {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
};

type ItemType = "COINS" | "SHIELD" | "ROCKET" | "1-UP" | "SLOW" | "FAST_MONSTER" | "BOMB";

type Item = {
  x: number;
  y: number;
  type: ItemType;
  life: number;
};

type Game = ReturnType<typeof createInitialGame>;

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
  const speed = BASE_QIX_SPEED + level * QIX_SPEED_PER_LEVEL;
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
  const speed = BASE_SPARK_SPEED + level * SPARK_SPEED_PER_LEVEL;
  const sparks: Spark[] = [];
  
  // All sparks spawn from the top-center origin (original QIX behaviour)
  const topCenter = Math.floor(COLS / 2);
  for (let i = 0; i < count; i++) {
    const dx = i % 2 === 0 ? 1 : -1;
    sparks.push({
      x: topCenter,
      y: 0,
      dx: dx,
      dy: 0,
      speed,
      progress: 0,
      perimeterIndex: i * 10,
    });
  }
  return sparks;
}

function updateSpark(spark: Spark, claimed: boolean[][], distanceMap: number[][] | null, monsterSpeedMultiplier = 1.0): Spark {
  let progress = spark.progress + spark.speed * monsterSpeedMultiplier;
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
    slowClaimed: new Set<string>(),
    idleNoDrawTimer: 0,
    floatingTexts: [] as FloatingText[],
    items: [] as Item[],
    shieldTimer: 0,
    speedTimer: 0,
    slowTimer: 0,
    spaceHeld: false,
    slowDrawUsed: false,
    playerMomentum: 0,
    itemSpawnTimer: 0,
    monsterSpeedTimer: 0,
  };
}

function spawnSparkAtOrigin(level: number, existing: Spark[]): Spark {
  const speed = BASE_SPARK_SPEED + level * SPARK_SPEED_PER_LEVEL;
  const dx = existing.length % 2 === 0 ? 1 : -1;
  return {
    x: Math.floor(COLS / 2),
    y: 0,
    dx,
    dy: 0,
    speed,
    progress: 0,
    perimeterIndex: existing.length * 10,
  };
}



function loseLife(game: Game, text: string): Game {
  const lives = game.lives - 1;
  spawnExplosion(game.player.x * CELL + CELL / 2, game.player.y * CELL + CELL / 2, "#00ffff", 30);
  spawnExplosion(game.player.x * CELL + CELL / 2, game.player.y * CELL + CELL / 2, "#ffff00", 15);
  const resetBase = {
    player: { x: Math.floor(COLS / 2), y: ROWS - 1 },
    dir: { x: 0, y: 0 },
    drawing: false,
    trail: [] as Point[],
    trailSet: new Set<string>(),
    fuseIndex: 0,
    fuseTimer: 0,
    slowClaimed: game.slowClaimed,
    idleNoDrawTimer: 0,
    items: [] as Item[],
    shieldTimer: 0,
    speedTimer: 0,
    slowTimer: 0,
    spaceHeld: false,
    slowDrawUsed: false,
    playerMomentum: 0,
    monsterSpeedTimer: 0,
  };
  if (lives <= 0) {
    return {
      ...game,
      ...resetBase,
      qix: resetQix(game.level),
      sparks: createSparks(game.level),
      lives: 0,
      status: "enterName",
      message: "GAME OVER",
    };
  }
  return {
    ...game,
    ...resetBase,
    qix: resetQix(game.level),
    sparks: createSparks(game.level),
    lives,
    status: "paused",
    message: text,
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
  
  // Respawn one new spark at the origin point (top-center) for each destroyed spark
  const respawnedSparks: Spark[] = [];
  const newFloatingTexts = [...game.floatingTexts];
  for (const spark of destroyedSparks) {
    respawnedSparks.push(spawnSparkAtOrigin(game.level, [...survivingSparks, ...respawnedSparks]));
    newFloatingTexts.push({
      x: spark.x * CELL + CELL / 2,
      y: spark.y * CELL + CELL / 2,
      text: `+${2500 + game.level * 500}`,
      life: 60,
      color: "#ffcc00"
    });
  }
  const allSparks = [...survivingSparks, ...respawnedSparks];

  // ── Items capture / BOMB explosion in area logic ──
  const survivingItems: Item[] = [];
  let bombTriggered = false;
  for (const item of game.items) {
    if (item.type === "BOMB" && claimed[item.y]?.[item.x] && !game.claimed[item.y]?.[item.x]) {
      spawnExplosion(item.x * CELL + CELL / 2, item.y * CELL + CELL / 2, "#ff0000", 40);
      newFloatingTexts.push({
        x: item.x * CELL + CELL / 2, y: item.y * CELL + CELL / 2,
        text: "BOOM!", life: 30, color: "#ff0000"
      });
      // Damage surrounding claimed area
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const nx = item.x + dx;
          const ny = item.y + dy;
          if (nx > 0 && nx < COLS - 1 && ny > 0 && ny < ROWS - 1) {
            if (Math.hypot(dx, dy) <= 4) {
              claimed[ny][nx] = false;
            }
          }
        }
      }
      if (Math.hypot(game.player.x - item.x, game.player.y - item.y) <= 4) {
        bombTriggered = true;
      }
    } else {
      survivingItems.push(item);
    }
  }

  if (bombTriggered && game.shieldTimer <= 0) {
    return loseLife(game, "BOMB!");
  }

  const percent = areaPercent(claimed);
  const sparkBonus = destroyedSparks.length * (POINTS_PER_SPARK_DESTROYED_BASE + game.level * POINTS_PER_SPARK_DESTROYED_PER_LEVEL);
  const areaPoints = gained * POINTS_PER_AREA_CELL + game.trail.length * POINTS_PER_TRAIL_CELL;
  // Only voluntary Space slow draw grants the 2x area score bonus.
  const score = game.score + (game.slowDrawUsed ? areaPoints * SLOW_AREA_POINTS_MULTIPLIER : areaPoints) + sparkBonus;
  
  // Track slow-claimed cells for visual rendering
  const newSlowClaimed = new Set(game.slowClaimed);
  if (game.slowDrawUsed) {
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
    sparks: allSparks,
    drawing: false,
    percent,
    score,
    slowClaimed: newSlowClaimed,
    status: won ? "won" : game.status,
    message: won ? "Livello Completato" : "",
    idleNoDrawTimer: 0,
    floatingTexts: newFloatingTexts,
    items: survivingItems,
    shieldTimer: game.shieldTimer,
    speedTimer: game.speedTimer,
    slowTimer: game.slowTimer,
    spaceHeld: game.spaceHeld,
    slowDrawUsed: false,
    itemSpawnTimer: game.itemSpawnTimer,
    monsterSpeedTimer: game.monsterSpeedTimer,
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
  let qixSpeed = BASE_QIX_SPEED + game.level * 0.1;
  if (game.monsterSpeedTimer > 0) {
    qixSpeed *= 1.4; // 40% faster for FAST_MONSTER
  }
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
        nextQix.vx = (nextQix.vx / mag) * qixSpeed;
        nextQix.vy = (nextQix.vy / mag) * qixSpeed;
      }
      break; // Re-evaluate on next frame
    } else {
      nextQix.x = nx;
      nextQix.y = ny;
    }
  }

  // ── UPDATE TIMERS ──
  const shieldTimer = Math.max(0, game.shieldTimer - 1);
  const speedTimer = Math.max(0, game.speedTimer - 1);
  const slowTimer = Math.max(0, (game.slowTimer ?? 0) - 1);
  const monsterSpeedTimer = Math.max(0, game.monsterSpeedTimer - 1);

  // ── ITEMS (POWERUPS + THREATS) LOGIC: spawn, update & expire ──
  let itemSpawnTimer = (game.itemSpawnTimer ?? 0) + 1;
  const currentItems = [...(game.items || [])]
    .map(item => ({ ...item, life: item.life - 1 }))
    .filter(item => item.life > 0);

  // Spawn new item with proper weights and chance
  if (itemSpawnTimer >= ITEM_SPAWN_INTERVAL_TICKS) {
    itemSpawnTimer = 0;
    if (Math.random() < ITEM_SPAWN_CHANCE && currentItems.length < MAX_ITEMS_ON_SCREEN) {
      // Pick random empty cell
      let emptyCells: Point[] = [];
      for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
          if (!game.claimed[y][x]) emptyCells.push({ x, y });
        }
      }
      if (emptyCells.length > 0) {
        const pickedCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        
        // Distribution of types using true exact weights (TOTAL_ITEM_WEIGHT):
        let r = Math.random() * TOTAL_ITEM_WEIGHT;
        let type: ItemType = "COINS";

        if (r < WEIGHT_ONE_UP) {
          type = "1-UP";
        } else if (r < WEIGHT_ONE_UP + WEIGHT_BOMB) {
          type = "BOMB";
        } else if (r < WEIGHT_ONE_UP + WEIGHT_BOMB + WEIGHT_SHIELD) {
          type = "SHIELD";
        } else if (r < WEIGHT_ONE_UP + WEIGHT_BOMB + WEIGHT_SHIELD + WEIGHT_ROCKET) {
          type = "ROCKET";
        } else if (r < WEIGHT_ONE_UP + WEIGHT_BOMB + WEIGHT_SHIELD + WEIGHT_ROCKET + WEIGHT_SLOW) {
          type = "SLOW";
        } else if (r < WEIGHT_ONE_UP + WEIGHT_BOMB + WEIGHT_SHIELD + WEIGHT_ROCKET + WEIGHT_SLOW + WEIGHT_FAST_MONSTER) {
          type = "FAST_MONSTER";
        } else {
          type = "COINS";
        }

        currentItems.push({
          x: pickedCell.x,
          y: pickedCell.y,
          type,
          life: ITEM_LIFETIME_TICKS,
        });
      }
    }
  }

  // ── UPDATE SPARKS ──
  const sparkTarget = !game.drawing && isBorderCell(game.player.x, game.player.y, game.claimed) ? game.player : null;
  const distanceMap = sparkTarget ? buildBorderDistanceMap(game.claimed, sparkTarget) : null;
  const monsterSpeedMultiplier = game.monsterSpeedTimer > 0 ? FAST_MONSTER_SPEED_MULTIPLIER : 1.0;
  let updatedSparks = game.sparks.map((spark) => updateSpark(spark, game.claimed, distanceMap, monsterSpeedMultiplier));

  // ── IDLE NO-DRAW TIMER ──
  let nextIdleTimer = (game.idleNoDrawTimer ?? 0);
  if (game.drawing) {
    nextIdleTimer = 0;
  } else {
    nextIdleTimer += 1;
    if (nextIdleTimer >= IDLE_NODRAW_THRESHOLD_TICKS && updatedSparks.length < MAX_SPARKS + EXTRA_SPAWN_SPARKS_LIMIT) {
      updatedSparks = [...updatedSparks, spawnSparkAtOrigin(game.level, updatedSparks)];
      spawnExplosion((COLS / 2) * CELL, 0, "#ff3700", 16);
      nextIdleTimer = 0;
    }
  }

  // ── UPDATE FLOATING TEXTS ──
  const updatedFloatingTexts = game.floatingTexts
    .map(ft => ({ ...ft, life: ft.life - 1, y: ft.y - 0.2 }))
    .filter(ft => ft.life > 0);

  let updated: Game = {
    ...game,
    qix: nextQix,
    sparks: updatedSparks,
    idleNoDrawTimer: nextIdleTimer,
    floatingTexts: updatedFloatingTexts,
    items: currentItems,
    shieldTimer,
    speedTimer,
    slowTimer,
    itemSpawnTimer,
    monsterSpeedTimer,
  };

  // ── ITEMS COLLECTION ──
  let collectedItems: Item[] = [];
  const remainingItems = currentItems.filter((item) => {
    const isCollected = Math.hypot(updated.player.x - item.x, updated.player.y - item.y) <= 1.5;
    if (isCollected) {
      collectedItems.push(item);
      return false;
    }
    return true;
  });

  for (const item of collectedItems) {
    if (item.type === "COINS") {
      updated.score += POINTS_COINS_PICKUP;
      updated.floatingTexts.push({
        x: item.x * CELL + CELL / 2, y: item.y * CELL + CELL / 2,
        text: `+${POINTS_COINS_PICKUP}`, life: 50, color: "#ffea00"
      });
    } else if (item.type === "SHIELD") {
      updated.shieldTimer = Math.ceil(SHIELD_DURATION_MS / TICK_MS);
      updated.floatingTexts.push({
        x: item.x * CELL + CELL / 2, y: item.y * CELL + CELL / 2,
        text: "SHIELD!", life: 50, color: "#00ffff"
      });
    } else if (item.type === "ROCKET") {
      updated.speedTimer = Math.ceil(ROCKET_DURATION_MS / TICK_MS);
      updated.floatingTexts.push({
        x: item.x * CELL + CELL / 2, y: item.y * CELL + CELL / 2,
        text: "SPEED UP!", life: 50, color: "#ff5500"
      });
    } else if (item.type === "1-UP") {
      updated.lives += 1;
      updated.floatingTexts.push({
        x: item.x * CELL + CELL / 2, y: item.y * CELL + CELL / 2,
        text: "1-UP!", life: 50, color: "#00ff66"
      });
    } else if (item.type === "SLOW") {
      updated.slowTimer = Math.ceil(SLOW_DURATION_MS / TICK_MS);
      updated.floatingTexts.push({
        x: item.x * CELL + CELL / 2, y: item.y * CELL + CELL / 2,
        text: "SLOW!", life: 50, color: "#ff8800"
      });
    } else if (item.type === "FAST_MONSTER") {
      updated.monsterSpeedTimer = Math.ceil(FAST_MONSTER_DURATION_MS / TICK_MS);
      updated.floatingTexts.push({
        x: item.x * CELL + CELL / 2, y: item.y * CELL + CELL / 2,
        text: "FAST MONSTERS!", life: 50, color: "#ff0000"
      });
    } else if (item.type === "BOMB") {
      spawnExplosion(item.x * CELL + CELL / 2, item.y * CELL + CELL / 2, "#ff0000", 40);
      updated.floatingTexts.push({
        x: item.x * CELL + CELL / 2, y: item.y * CELL + CELL / 2,
        text: "BOOM!", life: 30, color: "#ff0000"
      });
      // Damage surrounding claimed area
      for (let dy = -BOMB_EXPLOSION_RADIUS_CELLS; dy <= BOMB_EXPLOSION_RADIUS_CELLS; dy++) {
        for (let dx = -BOMB_EXPLOSION_RADIUS_CELLS; dx <= BOMB_EXPLOSION_RADIUS_CELLS; dx++) {
          const nx = item.x + dx;
          const ny = item.y + dy;
          if (nx > 0 && nx < COLS - 1 && ny > 0 && ny < ROWS - 1) {
            if (Math.hypot(dx, dy) <= BOMB_EXPLOSION_RADIUS_CELLS) {
              updated.claimed[ny][nx] = false;
            }
          }
        }
      }
      // If player is close, die
      if (Math.hypot(updated.player.x - item.x, updated.player.y - item.y) <= BOMB_KILL_DISTANCE_CELLS) {
        return loseLife(updated, "BOMB!");
      }
    }
    spawnExplosion(item.x * CELL + CELL / 2, item.y * CELL + CELL / 2, "#ff8800", 12);
  }
  updated.items = remainingItems;

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
    
    if (newFuseTimer >= FUSE_ADVANCE_TICKS) {
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

  // ── Early spark check on border (even when not moving) ──
  if (!updated.drawing && updated.shieldTimer <= 0) {
    for (const spark of updated.sparks) {
      if (spark.x === updated.player.x && spark.y === updated.player.y) {
        return loseLife(updated, "Uno Sparx ti ha raggiunto sul bordo.");
      }
    }
  }

  // ── SLOW/ROCKET: speed modifiers for player movement ──
  let moveMultiplier = 1.0;
  if (updated.slowTimer > 0) {
    moveMultiplier *= SLOW_SPEED_MULTIPLIER;
  }
  if (updated.drawing && updated.spaceHeld) {
    moveMultiplier *= SLOW_SPEED_MULTIPLIER;
    updated = { ...updated, slowDrawUsed: true };
  }
  if (updated.speedTimer > 0) {
    moveMultiplier *= ROCKET_SPEED_MULTIPLIER;
  }
  
  updated = { ...updated, playerMomentum: (updated.playerMomentum ?? 0) + moveMultiplier };
  const stepsToMove = Math.floor(updated.playerMomentum);
  if (stepsToMove < 1) {
    return updated; // Momentum not enough yet for 1 step
  }
  updated = { ...updated, playerMomentum: updated.playerMomentum - stepsToMove };

  for (let s = 0; s < stepsToMove; s++) {
    const player = updated.player;
    const target = {
      x: clamp(player.x + dir.x, 0, COLS - 1),
      y: clamp(player.y + dir.y, 0, ROWS - 1),
    };

    if (target.x === player.x && target.y === player.y) {
      break;
    }

    const targetKey = key(target.x, target.y);
    const targetClaimed = updated.claimed[target.y][target.x];
    const targetTrail = updated.trailSet.has(targetKey);

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
      const trailSet = new Set<string>([targetKey]);
    updated = { ...updated, drawing: true, player: target, trail: [target], trailSet, playerMomentum: 0, slowDrawUsed: updated.spaceHeld };
    }

    // Hit between player and QIX/Sparks
    if (updated.shieldTimer <= 0) {
      const playerHitQix = Math.abs(nextQix.x - updated.player.x) < 1.6 && Math.abs(nextQix.y - updated.player.y) < 1.6;
      if (playerHitQix) {
        return loseLife(updated, "Il QIX ti ha colpito.");
      }

      for (const spark of updated.sparks) {
        const isPlayerHitOnBorder = spark.x === updated.player.x && spark.y === updated.player.y && !updated.drawing;
        if (isPlayerHitOnBorder) {
          return loseLife(updated, "Uno Sparx ti ha raggiunto sul bordo.");
        }

        if (updated.drawing) {
          const isSparkHittingTrail = updated.trail.some(
            (pt) => Math.abs(spark.x - pt.x) <= 1 && Math.abs(spark.y - pt.y) <= 1
          );
          if (isSparkHittingTrail) {
            return loseLife(updated, "Uno Sparx ha colpito la tua scia.");
          }
        }
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

  // ── Items (Power-ups & Threats - retro 80s icons) ──
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
    } else if (game.slowDrawUsed || (game.drawing && game.spaceHeld)) {
      // Voluntary Space slow-draw trail: red/orange glow
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
  const playerColor = game.drawing ? (game.slowDrawUsed || game.spaceHeld ? "#ff3300" : "#ffff00") : "#00ffff";
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

  // ── Floating Texts ──
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

  // ── Input Helper: Recompute direction from still-pressed keys ──
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
    gameRef.current = { ...gameRef.current, dir: newDir };
    sync();
  };

  // ── Keyboard handler ──
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

      // Allow restart with R from lost/won states → return to attract
      if (event.code === "KeyR" && (hud.status === "lost" || hud.status === "won")) {
        returnToAttract();
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
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
      if (event.code === "Space") {
        event.preventDefault();
        gameRef.current = { ...gameRef.current, spaceHeld: false };
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
            <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-[#00ff41]/60">★ Taito-inspired Arcade ★</p>
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
              <span className="text-[#00ff41]/60">♥</span>
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
                ★ DEMO PLAY ★
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