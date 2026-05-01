import {
  TICK_MS, TARGET_PERCENT, START_LIVES, COLS, ROWS, CELL_PX as CELL,
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
} from "../config/gameplayConstants";

export type Point = { x: number; y: number };
export type GameStatus = "ready" | "playing" | "paused" | "won" | "lost" | "enterName" | "splash" | "demo" | "attractScores";

export type FloatingText = {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
};

export type ItemType = "COINS" | "SHIELD" | "ROCKET" | "1-UP" | "SLOW" | "FAST_MONSTER" | "BOMB";

export type Item = {
  x: number;
  y: number;
  type: ItemType;
  life: number;
};

export type PlayerId = string;
export type CellOwner = PlayerId | null;

export const LOCAL_PLAYER_ID = "p1";

const PLAYER_SPAWNS: Point[] = [
  { x: Math.floor(COLS / 2), y: ROWS - 1 },
  { x: Math.floor(COLS / 2), y: 0 },
  { x: 0, y: Math.floor(ROWS / 2) },
  { x: COLS - 1, y: Math.floor(ROWS / 2) },
];

export type PlayerState = {
  id: PlayerId;
  position: Point;
  dir: Point;
  drawing: boolean;
  trail: Point[];
  trailSet: Set<string>;
  score: number;
  lives: number;
  fuseIndex: number;
  fuseTimer: number;
  shieldTimer: number;
  speedTimer: number;
  slowTimer: number;
  spaceHeld: boolean;
  slowDrawUsed: boolean;
  playerMomentum: number;
};

export type Game = ReturnType<typeof createInitialGame>;

type GameEngineEffects = {
  spawnExplosion?: (x: number, y: number, color: string, count?: number) => void;
  scheduleEffect?: (callback: () => void, delayMs: number) => void;
};

let engineEffects: GameEngineEffects = {};
let randomSource: () => number = Math.random;

export function configureGameEngineEffects(effects: GameEngineEffects) {
  engineEffects = effects;
}

export function setGameRandom(nextRandom: () => number = Math.random) {
  randomSource = nextRandom;
}

function random() {
  return randomSource();
}

function emitExplosion(x: number, y: number, color: string, count = 20) {
  engineEffects.spawnExplosion?.(x, y, color, count);
}

function scheduleEngineEffect(callback: () => void, delayMs: number) {
  if (engineEffects.scheduleEffect) {
    engineEffects.scheduleEffect(callback, delayMs);
  } else if (typeof window !== "undefined") {
    window.setTimeout(callback, delayMs);
  } else {
    setTimeout(callback, delayMs);
  }
}

export function createInitialPlayerState(id: PlayerId = LOCAL_PLAYER_ID, carryOverScore = 0): PlayerState {
  const spawnIndex = Math.max(0, Number(id.replace(/\D/g, "")) - 1);
  const spawn = PLAYER_SPAWNS[spawnIndex % PLAYER_SPAWNS.length] ?? PLAYER_SPAWNS[0];
  return {
    id,
    position: { ...spawn },
    dir: { x: 0, y: 0 },
    drawing: false,
    trail: [],
    trailSet: new Set<string>(),
    score: carryOverScore,
    lives: START_LIVES,
    fuseIndex: 0,
    fuseTimer: 0,
    shieldTimer: 0,
    speedTimer: 0,
    slowTimer: 0,
    spaceHeld: false,
    slowDrawUsed: false,
    playerMomentum: 0,
  };
}

export function addPlayerToGame(game: Game, playerId: PlayerId): Game {
  if (game.players[playerId]) return game;
  const nextPlayer = createInitialPlayerState(playerId);
  const next = {
    ...game,
    players: {
      ...game.players,
      [playerId]: nextPlayer,
    },
  };
  return playerId === LOCAL_PLAYER_ID ? syncLegacyFieldsFromPlayer(next) : next;
}

export function getPlayerState(game: Game, playerId: PlayerId = LOCAL_PLAYER_ID): PlayerState {
  return game.players[playerId] ?? createInitialPlayerState(playerId, game.score);
}

export function updatePlayerState(game: Game, patch: Partial<PlayerState>, playerId: PlayerId = LOCAL_PLAYER_ID): Game {
  const current = getPlayerState(game, playerId);
  const nextPlayer: PlayerState = {
    ...current,
    ...patch,
    id: current.id,
    position: patch.position ? { ...patch.position } : current.position,
    dir: patch.dir ? { ...patch.dir } : current.dir,
    trail: patch.trail ? [...patch.trail] : current.trail,
    trailSet: patch.trailSet ? new Set(patch.trailSet) : current.trailSet,
  };

  return syncLegacyFieldsFromPlayer({
    ...game,
    players: {
      ...game.players,
      [playerId]: nextPlayer,
    },
  }, playerId);
}

export function syncPlayersFromLegacyFields(game: Game, playerId: PlayerId = LOCAL_PLAYER_ID): Game {
  const existing = game.players[playerId] ?? createInitialPlayerState(playerId, game.score);
  const nextPlayer: PlayerState = {
    ...existing,
    position: { ...game.player },
    dir: { ...game.dir },
    drawing: game.drawing,
    trail: [...game.trail],
    trailSet: new Set(game.trailSet),
    score: game.score,
    lives: game.lives,
    fuseIndex: game.fuseIndex,
    fuseTimer: game.fuseTimer,
    shieldTimer: game.shieldTimer,
    speedTimer: game.speedTimer,
    slowTimer: game.slowTimer,
    spaceHeld: game.spaceHeld,
    slowDrawUsed: game.slowDrawUsed,
    playerMomentum: game.playerMomentum,
  };

  return {
    ...game,
    players: {
      ...game.players,
      [playerId]: nextPlayer,
    },
  };
}

export function syncLegacyFieldsFromPlayer(game: Game, playerId: PlayerId = LOCAL_PLAYER_ID): Game {
  const player = getPlayerState(game, playerId);
  return {
    ...game,
    player: { ...player.position },
    dir: { ...player.dir },
    drawing: player.drawing,
    trail: [...player.trail],
    trailSet: new Set(player.trailSet),
    score: player.score,
    lives: player.lives,
    fuseIndex: player.fuseIndex,
    fuseTimer: player.fuseTimer,
    shieldTimer: player.shieldTimer,
    speedTimer: player.speedTimer,
    slowTimer: player.slowTimer,
    spaceHeld: player.spaceHeld,
    slowDrawUsed: player.slowDrawUsed,
    playerMomentum: player.playerMomentum,
  };
}
export type Spark = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  progress: number;
  // Track distance along a perimeter for coordinated movement
  perimeterIndex: number;
};
export const DIRS: Record<string, Point> = {
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

export function key(x: number, y: number) {
  return `${x},${y}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function createClaimed() {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(false) as boolean[]);
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      grid[y][x] = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
    }
  }
  return grid;
}

export function copyClaimed(grid: boolean[][]) {
  return grid.map((row) => [...row]);
}

export function createOwnerGrid() {
  return Array.from({ length: ROWS }, () => Array<CellOwner>(COLS).fill(null));
}

export function copyOwnerGrid(grid: CellOwner[][]) {
  return grid.map((row) => [...row]);
}

export function countOwnedCells(grid: CellOwner[][], owner: PlayerId) {
  let count = 0;
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (grid[y][x] === owner) count += 1;
    }
  }
  return count;
}

export function areaPercent(grid: boolean[][]) {
  let claimed = 0;
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (grid[y][x]) claimed += 1;
    }
  }
  return Math.floor((claimed / (COLS * ROWS)) * 100);
}

export function resetQix(level: number) {
  const angle = random() * Math.PI * 2;
  const speed = BASE_QIX_SPEED + level * QIX_SPEED_PER_LEVEL;
  return {
    x: COLS * 0.5,
    y: ROWS * 0.5,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    phase: random() * Math.PI * 2,
  };
}

export function isBorderCell(x: number, y: number, claimed: boolean[][]) {
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

export function findNearestOpenCell(startX: number, startY: number, claimed: boolean[][]): Point {
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

export function buildBorderDistanceMap(claimed: boolean[][], target: Point) {
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

export function createSparks(level: number): Spark[] {
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

export function updateSpark(spark: Spark, claimed: boolean[][], distanceMap: number[][] | null, monsterSpeedMultiplier = 1.0): Spark {
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
    const choice = pool[Math.floor(random() * pool.length)];

    dx = choice.d.x;
    dy = choice.d.y;
    sx = choice.x;
    sy = choice.y;
  }

  return { ...spark, x: sx, y: sy, dx, dy, progress };
}

export function findNearestBorderCell(startX: number, startY: number, claimed: boolean[][]): Point {
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

export function createInitialGame(level = 1, carryOverScore = 0) {
  const claimed = createClaimed();
  const localPlayer = createInitialPlayerState(LOCAL_PLAYER_ID, carryOverScore);
  return {
    claimed,
    ownerGrid: createOwnerGrid(),
    players: {
      [LOCAL_PLAYER_ID]: localPlayer,
    },
    player: { ...localPlayer.position },
    dir: { ...localPlayer.dir },
    drawing: localPlayer.drawing,
    trail: [...localPlayer.trail],
    trailSet: new Set(localPlayer.trailSet),
    qix: resetQix(level),
    sparks: createSparks(level),
    score: localPlayer.score,
    percent: areaPercent(claimed),
    lives: localPlayer.lives,
    level,
    status: "ready" as GameStatus,
    message: `Livello ${level} â€” Premi una freccia o WASD per iniziare`,
    fuseIndex: localPlayer.fuseIndex,
    fuseTimer: localPlayer.fuseTimer,
    slowClaimed: new Set<string>(),
    idleNoDrawTimer: 0,
    floatingTexts: [] as FloatingText[],
    items: [] as Item[],
    shieldTimer: localPlayer.shieldTimer,
    speedTimer: localPlayer.speedTimer,
    slowTimer: localPlayer.slowTimer,
    spaceHeld: localPlayer.spaceHeld,
    slowDrawUsed: localPlayer.slowDrawUsed,
    playerMomentum: localPlayer.playerMomentum,
    itemSpawnTimer: 0,
    monsterSpeedTimer: 0,
  };
}

export function spawnSparkAtOrigin(level: number, existing: Spark[]): Spark {
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



export function loseLife(game: Game, text: string): Game {
  game = syncLegacyFieldsFromPlayer(game);
  const lives = game.lives - 1;
  emitExplosion(game.player.x * CELL + CELL / 2, game.player.y * CELL + CELL / 2, "#00ffff", 30);
  emitExplosion(game.player.x * CELL + CELL / 2, game.player.y * CELL + CELL / 2, "#ffff00", 15);
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
    return syncPlayersFromLegacyFields({
      ...game,
      ...resetBase,
      qix: resetQix(game.level),
      sparks: createSparks(game.level),
      lives: 0,
      status: "enterName",
      message: "GAME OVER",
    });
  }
  return syncPlayersFromLegacyFields({
    ...game,
    ...resetBase,
    qix: resetQix(game.level),
    sparks: createSparks(game.level),
    lives,
    status: "paused",
    message: text,
  });
}

export function claimClosedArea(game: Game): Game {
  game = syncLegacyFieldsFromPlayer(game);
  const claimed = copyClaimed(game.claimed);
  const ownerGrid = copyOwnerGrid(game.ownerGrid);
  for (const p of game.trail) {
    claimed[p.y][p.x] = true;
    ownerGrid[p.y][p.x] = LOCAL_PLAYER_ID;
  }

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
        ownerGrid[y][x] = LOCAL_PLAYER_ID;
        gained += 1;
      }
    }
  }

  const destroyedSparks = game.sparks.filter((spark) => !isBorderCell(spark.x, spark.y, claimed));
  const survivingSparks = game.sparks.filter((spark) => isBorderCell(spark.x, spark.y, claimed));
  for (const spark of destroyedSparks) {
    emitExplosion(spark.x * CELL + CELL / 2, spark.y * CELL + CELL / 2, "#ff8c00", 26);
    emitExplosion(spark.x * CELL + CELL / 2, spark.y * CELL + CELL / 2, "#ffff00", 14);
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

  // â”€â”€ Items capture / BOMB explosion in area logic â”€â”€
  const survivingItems: Item[] = [];
  let bombTriggered = false;
  for (const item of game.items) {
    if (item.type === "BOMB" && claimed[item.y]?.[item.x] && !game.claimed[item.y]?.[item.x]) {
      emitExplosion(item.x * CELL + CELL / 2, item.y * CELL + CELL / 2, "#ff0000", 40);
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
              ownerGrid[ny][nx] = null;
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
      scheduleEngineEffect(() => {
        emitExplosion(
          random() * COLS * CELL,
          random() * ROWS * CELL,
          colors[i % colors.length],
          20
        );
      }, i * 80);
    }
  }

  return syncPlayersFromLegacyFields({
    ...game,
    claimed,
    ownerGrid,
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
  });
}

export function stepGame(game: Game): Game {
  game = syncLegacyFieldsFromPlayer(game);
  if (game.status !== "playing") return syncPlayersFromLegacyFields(game);

  const nextQix = { ...game.qix, phase: game.qix.phase + 0.18 };
  const currentQixCell = { x: Math.round(nextQix.x), y: Math.round(nextQix.y) };
  if (game.claimed[currentQixCell.y]?.[currentQixCell.x]) {
    const open = findNearestOpenCell(nextQix.x, nextQix.y, game.claimed);
    nextQix.x = open.x;
    nextQix.y = open.y;
  }

  // â”€â”€ STRICT QIX MOVEMENT â”€â”€
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
      nextQix.vx += (random() - 0.5) * 0.25;
      nextQix.vy += (random() - 0.5) * 0.25;

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

  // â”€â”€ UPDATE TIMERS â”€â”€
  const shieldTimer = Math.max(0, game.shieldTimer - 1);
  const speedTimer = Math.max(0, game.speedTimer - 1);
  const slowTimer = Math.max(0, (game.slowTimer ?? 0) - 1);
  const monsterSpeedTimer = Math.max(0, game.monsterSpeedTimer - 1);

  // â”€â”€ ITEMS (POWERUPS + THREATS) LOGIC: spawn, update & expire â”€â”€
  let itemSpawnTimer = (game.itemSpawnTimer ?? 0) + 1;
  const currentItems = [...(game.items || [])]
    .map(item => ({ ...item, life: item.life - 1 }))
    .filter(item => item.life > 0);

  // Spawn new item with proper weights and chance
  if (itemSpawnTimer >= ITEM_SPAWN_INTERVAL_TICKS) {
    itemSpawnTimer = 0;
    if (random() < ITEM_SPAWN_CHANCE && currentItems.length < MAX_ITEMS_ON_SCREEN) {
      // Pick random empty cell
      let emptyCells: Point[] = [];
      for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
          if (!game.claimed[y][x]) emptyCells.push({ x, y });
        }
      }
      if (emptyCells.length > 0) {
        const pickedCell = emptyCells[Math.floor(random() * emptyCells.length)];
        
        // Distribution of types using true exact weights (TOTAL_ITEM_WEIGHT):
        let r = random() * TOTAL_ITEM_WEIGHT;
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

  // â”€â”€ UPDATE SPARKS â”€â”€
  const sparkTarget = !game.drawing && isBorderCell(game.player.x, game.player.y, game.claimed) ? game.player : null;
  const distanceMap = sparkTarget ? buildBorderDistanceMap(game.claimed, sparkTarget) : null;
  const monsterSpeedMultiplier = game.monsterSpeedTimer > 0 ? FAST_MONSTER_SPEED_MULTIPLIER : 1.0;
  let updatedSparks = game.sparks.map((spark) => updateSpark(spark, game.claimed, distanceMap, monsterSpeedMultiplier));

  // â”€â”€ IDLE NO-DRAW TIMER â”€â”€
  let nextIdleTimer = (game.idleNoDrawTimer ?? 0);
  if (game.drawing) {
    nextIdleTimer = 0;
  } else {
    nextIdleTimer += 1;
    if (nextIdleTimer >= IDLE_NODRAW_THRESHOLD_TICKS && updatedSparks.length < MAX_SPARKS + EXTRA_SPAWN_SPARKS_LIMIT) {
      updatedSparks = [...updatedSparks, spawnSparkAtOrigin(game.level, updatedSparks)];
      emitExplosion((COLS / 2) * CELL, 0, "#ff3700", 16);
      nextIdleTimer = 0;
    }
  }

  // â”€â”€ UPDATE FLOATING TEXTS â”€â”€
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

  // â”€â”€ ITEMS COLLECTION â”€â”€
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
      emitExplosion(item.x * CELL + CELL / 2, item.y * CELL + CELL / 2, "#ff0000", 40);
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
              updated.ownerGrid[ny][nx] = null;
            }
          }
        }
      }
      // If player is close, die
      if (Math.hypot(updated.player.x - item.x, updated.player.y - item.y) <= BOMB_KILL_DISTANCE_CELLS) {
        return loseLife(updated, "BOMB!");
      }
    }
    emitExplosion(item.x * CELL + CELL / 2, item.y * CELL + CELL / 2, "#ff8800", 12);
  }
  updated.items = remainingItems;

  // â”€â”€ CHECK TRAIL COLLISIONS â”€â”€
  // Check if QIX overlaps with any cell in the trail (distance-based collision)
  const qixHitTrail = qixHitTrailDuringMove || game.trail.some((pt) => {
    const dx = nextQix.x - pt.x;
    const dy = nextQix.y - pt.y;
    return Math.sqrt(dx * dx + dy * dy) < 1.95;
  });

  if (qixHitTrail && updated.shieldTimer <= 0) {
    return loseLife(updated, "Il QIX ha tagliato la tua scia.");
  }

  const dir = updated.dir;

  // â”€â”€ FUSE: burn trail when player stops while drawing â”€â”€
  if (updated.drawing && dir.x === 0 && dir.y === 0) {
    const newFuseTimer = updated.fuseTimer + 1;
    let newFuseIndex = updated.fuseIndex;
    
    if (newFuseTimer >= FUSE_ADVANCE_TICKS) {
      newFuseIndex = updated.fuseIndex + 1;
      updated = { ...updated, fuseTimer: 0, fuseIndex: newFuseIndex };
      
      // Spark at the fuse head
      if (newFuseIndex < updated.trail.length) {
        const fusePt = updated.trail[newFuseIndex];
        emitExplosion(fusePt.x * CELL + CELL / 2, fusePt.y * CELL + CELL / 2, "#ff3700", 4);
      }
    } else {
      updated = { ...updated, fuseTimer: newFuseTimer };
    }
    
    if (updated.fuseIndex >= updated.trail.length) {
      return loseLife(updated, "La miccia ha raggiunto la tua penna.");
    }
    
    return syncPlayersFromLegacyFields(updated);
  }

  // â”€â”€ Player resumes moving: cancel fuse â”€â”€
  if (updated.drawing && updated.fuseIndex > 0) {
    updated = { ...updated, fuseIndex: 0, fuseTimer: 0 };
  }

  // â”€â”€ Early spark check on border (even when not moving) â”€â”€
  if (!updated.drawing && updated.shieldTimer <= 0) {
    for (const spark of updated.sparks) {
      if (spark.x === updated.player.x && spark.y === updated.player.y) {
        return loseLife(updated, "Uno Sparx ti ha raggiunto sul bordo.");
      }
    }
  }

  // â”€â”€ SLOW/ROCKET: speed modifiers for player movement â”€â”€
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
    return syncPlayersFromLegacyFields(updated); // Momentum not enough yet for 1 step
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

  return syncPlayersFromLegacyFields(updated);
}

// â”€â”€ Demo AI: simple player that claims territory â”€â”€
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

export function getAIDirection(game: Game): Point {
  game = syncLegacyFieldsFromPlayer(game);
  const p = game.player;
  const qixX = Math.round(game.qix.x);
  const qixY = Math.round(game.qix.y);
  
  // Simple AI: move along border, occasionally venture inward
  if (game.drawing) {
    // If drawing, try to close the shape by heading back to border
    aiState.drawDepth++;
    
    // After going deep enough, head back to claimed territory
    if (aiState.drawDepth > 8 + Math.floor(random() * 8)) {
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
      const chosen = turns[Math.floor(random() * turns.length)];
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
    if (random() < 0.03) {
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
        const chosen = inward[Math.floor(random() * inward.length)];
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
      const chosen = claimedNeighbors[Math.floor(random() * claimedNeighbors.length)];
      aiState.currentDir = chosen;
      return chosen;
    }
  }
  
  return aiState.currentDir;
}

export function stepDemoGame(game: Game): Game {
  // AI decides direction
  const aiDir = getAIDirection(game);
  const gameWithDir = updatePlayerState(game, { dir: aiDir });
  return stepGame(gameWithDir);
}


