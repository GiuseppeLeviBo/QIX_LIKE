import { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };
type GameStatus = "ready" | "playing" | "paused" | "won" | "lost";
type AttractPhase = "title" | "demo" | "scores" | "off";
type HighScoreEntry = { initials: string; score: number; level: number; percent: number; date: string };
type PendingScore = Omit<HighScoreEntry, "initials">;
type Game = ReturnType<typeof createInitialGame>;
type AttractState = { phase: AttractPhase; ticks: number };
type AutoPilotState = {
  enabled: boolean;
  route: Point[];
  endTicks: number;
  stuckTicks: number;
  lastPlayerKey: string;
};
type DebugWindow = Window & { __qixDebug?: unknown };

const COLS = 88;
const ROWS = 60;
const CELL = 10;
const TICK_MS = 52;
const TARGET_PERCENT = 75;
const START_LIVES = 3;
const HIGH_SCORE_LIMIT = 10;
const HIGH_SCORE_KEY = "qix-style-high-scores";
const MAX_SPARKS = 5;
const BASE_QIX_SPEED = 1.18;
const QIX_LEVEL_SPEED_STEP = 0.12;
const QIX_LOOKAHEAD = 8;
const BASE_SPARK_SPEED = 0.9;
const QIX_BODY_RADIUS = 2;
const QIX_TRAIL_TOUCH_RADIUS = 2;
const SPARK_TRAIL_TOUCH_RADIUS = 1;
const SPARK_CAPTURE_BONUS = 2500;
const SLOW_DRAW_MULTIPLIER = 2;
const FUSE_SPEED = 0.35;
const AUTOPLAY_SETTLE_TICKS = 36;
const AUTOPLAY_MAX_ROUTE = 24;
const AUTOPLAY_QIX_DANGER = 18;
const AUTOPLAY_SPARK_DANGER = 8;
const ATTRACT_TITLE_TICKS = Math.round(10000 / TICK_MS);
const ATTRACT_DEMO_TICKS = Math.round(20000 / TICK_MS);
const ATTRACT_SCORES_TICKS = Math.round(10000 / TICK_MS);
const POST_GAME_ATTRACT_TICKS = Math.round(10000 / TICK_MS);
const ZERO_DIR: Point = { x: 0, y: 0 };
const LEGAL_NOTICE =
  "QIX® è un marchio registrato di TAITO CORPORATION. Questo progetto è un omaggio indipendente non affiliato, sponsorizzato o approvato da TAITO CORPORATION.";
const CARDINALS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
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

function key(x: number, y: number) {
  return `${x},${y}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function perimeterLength() {
  return (COLS - 1) * 2 + (ROWS - 1) * 2;
}

function normalizePerimeterIndex(value: number) {
  const perimeter = perimeterLength();
  return ((value % perimeter) + perimeter) % perimeter;
}

function perimeterPoint(index: number): Point {
  let n = normalizePerimeterIndex(index);
  if (n < COLS - 1) return { x: n, y: 0 };
  n -= COLS - 1;
  if (n < ROWS - 1) return { x: COLS - 1, y: n };
  n -= ROWS - 1;
  if (n < COLS - 1) return { x: COLS - 1 - n, y: ROWS - 1 };
  n -= COLS - 1;
  return { x: 0, y: ROWS - 1 - n };
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

function createSlowClaimed() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(false) as boolean[]);
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

function normalizeInitials(value: string) {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  return (cleaned || "AAA").padEnd(3, "A");
}

function loadHighScores(): HighScoreEntry[] {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((entry) => ({
        initials: normalizeInitials(String(entry?.initials ?? "AAA")),
        score: Number(entry?.score ?? 0),
        level: Number(entry?.level ?? 1),
        percent: Number(entry?.percent ?? 0),
        date: String(entry?.date ?? ""),
      }))
      .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, HIGH_SCORE_LIMIT);
  } catch {
    return [];
  }
}

function saveHighScores(scores: HighScoreEntry[]) {
  localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(scores.slice(0, HIGH_SCORE_LIMIT)));
}

function qualifiesHighScore(scores: HighScoreEntry[], score: number) {
  return score > 0 && (scores.length < HIGH_SCORE_LIMIT || score > scores[scores.length - 1].score);
}

function insertHighScore(scores: HighScoreEntry[], entry: HighScoreEntry) {
  return [...scores, entry].sort((a, b) => b.score - a.score).slice(0, HIGH_SCORE_LIMIT);
}

function qixSpeedForLevel(level: number) {
  return BASE_QIX_SPEED + Math.max(0, level - 1) * QIX_LEVEL_SPEED_STEP;
}

function resetQix(level: number) {
  const angle = Math.random() * Math.PI * 2;
  const speed = qixSpeedForLevel(level);
  return {
    x: COLS * 0.5 + (Math.random() - 0.5) * 8,
    y: ROWS * 0.42 + (Math.random() - 0.5) * 8,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    phase: Math.random() * Math.PI * 2,
  };
}

function createSparks(level: number) {
  const count = Math.min(2 + Math.floor(level / 2), MAX_SPARKS);
  const speed = BASE_SPARK_SPEED + level * 0.15;
  const perimeter = perimeterLength();
  const sparks = [];
  for (let i = 0; i < count; i++) {
    const t = (perimeter / count) * i + Math.random() * 5;
    const direction = i % 2 === 0 ? 1 : -1;
    const pos = perimeterPoint(t);
    const next = perimeterPoint(t + direction);
    sparks.push({
      x: pos.x,
      y: pos.y,
      dx: next.x - pos.x,
      dy: next.y - pos.y,
      speed,
      carry: Math.random(),
      phase: t,
    });
  }
  return sparks;
}

function createInitialGame(level = 1) {
  const claimed = createClaimed();
  return {
    claimed,
    slowClaimed: createSlowClaimed(),
    player: { x: Math.floor(COLS / 2), y: ROWS - 1 },
    dir: { x: 0, y: 0 },
    moveTick: 0,
    slowMode: false,
    drawing: false,
    slowTrail: true,
    fuse: 0,
    trail: [] as Point[],
    trailSet: new Set<string>(),
    qix: resetQix(level),
    sparks: createSparks(level),
    score: 0,
    percent: areaPercent(claimed),
    lives: START_LIVES,
    level,
    status: "ready" as GameStatus,
    message: `Livello ${level} — Premi una freccia o WASD per iniziare`,
  };
}

function expandedCells(cells: Point[], radius: number): Point[] {
  const seen = new Set<string>();
  const expanded: Point[] = [];

  for (const cell of cells) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) > radius) continue;
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        const cellKey = key(x, y);
        if (!seen.has(cellKey)) {
          seen.add(cellKey);
          expanded.push({ x, y });
        }
      }
    }
  }

  return expanded;
}

function sweptGridCells(from: Point, to: Point): Point[] {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) * 3));
  const seen = new Set<string>();
  const cells: Point[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const ratio = i / steps;
    const x = Math.round(from.x + (to.x - from.x) * ratio);
    const y = Math.round(from.y + (to.y - from.y) * ratio);
    const cellKey = key(x, y);
    if (!seen.has(cellKey)) {
      seen.add(cellKey);
      cells.push({ x, y });
    }
  }

  return cells;
}

function qixTrailTouchCells(from: Point, to: Point): Point[] {
  return expandedCells(sweptGridCells(from, to), QIX_TRAIL_TOUCH_RADIUS);
}

function isInsideGrid(x: number, y: number) {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS;
}

function isInteriorCell(x: number, y: number) {
  return x > 0 && y > 0 && x < COLS - 1 && y < ROWS - 1;
}

function isClaimedGridCell(grid: boolean[][], x: number, y: number) {
  return isInsideGrid(x, y) && Boolean(grid[y]?.[x]);
}

function isSparkBoundaryCell(grid: boolean[][], x: number, y: number) {
  if (!isClaimedGridCell(grid, x, y)) return false;
  if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) return true;
  return CARDINALS.some((dir) => isInsideGrid(x + dir.x, y + dir.y) && !grid[y + dir.y]?.[x + dir.x]);
}

function isOuterBoundaryCell(x: number, y: number) {
  return x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
}

function isInternalSparkBoundaryCell(grid: boolean[][], x: number, y: number) {
  return isSparkBoundaryCell(grid, x, y) && !isOuterBoundaryCell(x, y);
}

function sparkBoundaryNeighbors(grid: boolean[][], x: number, y: number) {
  return CARDINALS
    .map((dir) => ({ x: x + dir.x, y: y + dir.y }))
    .filter((cell) => isSparkBoundaryCell(grid, cell.x, cell.y));
}

function collectInternalSparkBoundaryCells(grid: boolean[][]) {
  const cells: Point[] = [];
  for (let y = 1; y < ROWS - 1; y += 1) {
    for (let x = 1; x < COLS - 1; x += 1) {
      if (isInternalSparkBoundaryCell(grid, x, y)) cells.push({ x, y });
    }
  }
  return cells;
}

function nearestPoint(points: Point[], from: Point, offset = 0) {
  if (points.length === 0) return undefined;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < points.length; i += 1) {
    const distance = manhattan(points[i], from) + ((i + offset) % 7) * 0.001;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return points[(bestIndex + offset) % points.length];
}

function nearestSparkBoundaryCell(grid: boolean[][], fromX: number, fromY: number): Point {
  const startX = clamp(Math.round(fromX), 0, COLS - 1);
  const startY = clamp(Math.round(fromY), 0, ROWS - 1);
  const maxRadius = Math.max(COLS, ROWS);

  for (let searchRadius = 0; searchRadius <= maxRadius; searchRadius += 1) {
    for (let y = startY - searchRadius; y <= startY + searchRadius; y += 1) {
      for (let x = startX - searchRadius; x <= startX + searchRadius; x += 1) {
        if (
          searchRadius > 0 &&
          x !== startX - searchRadius &&
          x !== startX + searchRadius &&
          y !== startY - searchRadius &&
          y !== startY + searchRadius
        ) {
          continue;
        }
        if (isSparkBoundaryCell(grid, x, y)) return { x, y };
      }
    }
  }

  return { x: 0, y: ROWS - 1 };
}

function manhattan(a: Point, b: Point) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function isReverseSparkMove(spark: Game["sparks"][number], current: Point, candidate: Point) {
  if (spark.dx === 0 && spark.dy === 0) return false;
  return candidate.x - current.x === -spark.dx && candidate.y - current.y === -spark.dy;
}

function moveSparkOnce(game: Game, spark: Game["sparks"][number]) {
  const current = isSparkBoundaryCell(game.claimed, spark.x, spark.y)
    ? { x: spark.x, y: spark.y }
    : nearestSparkBoundaryCell(game.claimed, spark.x, spark.y);
  const neighbors = sparkBoundaryNeighbors(game.claimed, current.x, current.y);

  if (neighbors.length === 0) {
    return { ...spark, ...current, dx: 0, dy: 0, phase: spark.phase + 0.35 };
  }

  const canChase = !game.drawing && isSparkBoundaryCell(game.claimed, game.player.x, game.player.y);
  const internalTarget = nearestPoint(collectInternalSparkBoundaryCells(game.claimed), current);
  const choices =
    neighbors.length > 1 ? neighbors.filter((candidate) => !isReverseSparkMove(spark, current, candidate)) : neighbors;
  let best = neighbors[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of choices.length > 0 ? choices : neighbors) {
    const dx = candidate.x - current.x;
    const dy = candidate.y - current.y;
    const continues = dx === spark.dx && dy === spark.dy ? 2 : 0;
    const chase = canChase ? -manhattan(candidate, game.player) * 0.45 : 0;
    const internal = isInternalSparkBoundaryCell(game.claimed, candidate.x, candidate.y) ? 1.8 : 0;
    const internalPull = internalTarget ? -manhattan(candidate, internalTarget) * 0.08 : 0;
    const cornerTurn = continues === 0 ? 0.35 : 0;
    const score = continues + cornerTurn + chase + internal + internalPull + Math.random() * 0.08;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return {
    ...spark,
    x: best.x,
    y: best.y,
    dx: best.x - current.x,
    dy: best.y - current.y,
    phase: spark.phase + 0.45,
  };
}

function moveSpark(game: Game, spark: Game["sparks"][number]) {
  let moved = spark;
  let carry = spark.carry + spark.speed;
  const steps = Math.max(1, Math.floor(carry));
  carry -= steps;
  const cells: Point[] = [{ x: spark.x, y: spark.y }];

  for (let i = 0; i < steps; i += 1) {
    moved = moveSparkOnce(game, moved);
    cells.push({ x: moved.x, y: moved.y });
  }

  return { spark: { ...moved, carry }, cells };
}

function isClaimedAt(game: Game, x: number, y: number) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  return !isInteriorCell(cx, cy) || Boolean(game.claimed[cy]?.[cx]);
}

function isQixBlockedAt(game: Game, x: number, y: number) {
  const cx = Math.round(x);
  const cy = Math.round(y);

  for (let dy = -QIX_BODY_RADIUS; dy <= QIX_BODY_RADIUS; dy += 1) {
    for (let dx = -QIX_BODY_RADIUS; dx <= QIX_BODY_RADIUS; dx += 1) {
      if (Math.abs(dx) + Math.abs(dy) > QIX_BODY_RADIUS) continue;
      if (isClaimedAt(game, cx + dx, cy + dy)) return true;
    }
  }

  return false;
}

function isClearInGrid(grid: boolean[][], trailSet: Set<string>, x: number, y: number, radius: number) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (Math.abs(dx) + Math.abs(dy) > radius) continue;
      const cx = x + dx;
      const cy = y + dy;
      if (!isInteriorCell(cx, cy) || grid[cy]?.[cx] || trailSet.has(key(cx, cy))) return false;
    }
  }

  return true;
}

function nearestOpenCellInGrid(grid: boolean[][], trailSet: Set<string>, fromX: number, fromY: number, radius = 0): Point {
  const startX = clamp(Math.round(fromX), 1, COLS - 2);
  const startY = clamp(Math.round(fromY), 1, ROWS - 2);
  const maxRadius = Math.max(COLS, ROWS);

  for (let searchRadius = 0; searchRadius <= maxRadius; searchRadius += 1) {
    for (let y = startY - searchRadius; y <= startY + searchRadius; y += 1) {
      for (let x = startX - searchRadius; x <= startX + searchRadius; x += 1) {
        if (
          searchRadius > 0 &&
          x !== startX - searchRadius &&
          x !== startX + searchRadius &&
          y !== startY - searchRadius &&
          y !== startY + searchRadius
        ) {
          continue;
        }
        if (!isInteriorCell(x, y)) continue;
        if (isClearInGrid(grid, trailSet, x, y, radius)) return { x, y };
      }
    }
  }

  if (radius > 0) return nearestOpenCellInGrid(grid, trailSet, fromX, fromY, 0);

  return { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };
}

function nearestOpenCell(game: Game, fromX: number, fromY: number): Point {
  return nearestOpenCellInGrid(game.claimed, game.trailSet, fromX, fromY, QIX_BODY_RADIUS);
}

function normalizeQixVelocity(qix: Game["qix"], speed: number) {
  const mag = Math.hypot(qix.vx, qix.vy);
  if (mag <= 0.0001) {
    const angle = Math.random() * Math.PI * 2;
    qix.vx = Math.cos(angle) * speed;
    qix.vy = Math.sin(angle) * speed;
    return;
  }

  qix.vx = (qix.vx / mag) * speed;
  qix.vy = (qix.vy / mag) * speed;
}

function scoreQixDirection(game: Game, x: number, y: number, vx: number, vy: number) {
  const mag = Math.hypot(vx, vy);
  if (mag <= 0.0001) return 0;

  const stepX = vx / mag;
  const stepY = vy / mag;
  let score = 0;

  for (let distance = 0.5; distance <= QIX_LOOKAHEAD; distance += 0.5) {
    if (isQixBlockedAt(game, x + stepX * distance, y + stepY * distance)) break;
    score = distance;
  }

  return score;
}

function steerQixTowardOpenSpace(game: Game, qix: Game["qix"], speed: number) {
  let bestAngle = Math.atan2(qix.vy, qix.vx);
  let bestScore = -1;
  const currentAngle = Math.atan2(qix.vy, qix.vx);

  for (let i = 0; i < 32; i += 1) {
    const angle = (Math.PI * 2 * i) / 32;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const continuity = (Math.cos(angle - currentAngle) + 1) * 0.08;
    const score = scoreQixDirection(game, qix.x, qix.y, vx, vy) + continuity;

    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }

  qix.vx = Math.cos(bestAngle) * speed;
  qix.vy = Math.sin(bestAngle) * speed;
}

function moveQix(game: Game) {
  const speed = qixSpeedForLevel(game.level);
  const qix = { ...game.qix, phase: game.qix.phase + 0.18 };

  if (isQixBlockedAt(game, qix.x, qix.y)) {
    const open = nearestOpenCell(game, qix.x, qix.y);
    qix.x = open.x;
    qix.y = open.y;
    steerQixTowardOpenSpace(game, qix, speed);
  }

  normalizeQixVelocity(qix, speed);
  if (scoreQixDirection(game, qix.x, qix.y, qix.vx, qix.vy) < 1.5) {
    steerQixTowardOpenSpace(game, qix, speed);
  }

  const subSteps = Math.max(4, Math.ceil(speed * 5));
  let movedDistance = 0;

  for (let step = 0; step < subSteps; step += 1) {
    const dx = qix.vx / subSteps;
    const dy = qix.vy / subSteps;
    const nextX = qix.x + dx;
    let blockedX = false;
    let blockedY = false;

    if (isQixBlockedAt(game, nextX, qix.y)) {
      qix.vx = -qix.vx;
      blockedX = true;
    } else {
      qix.x = nextX;
      movedDistance += Math.abs(dx);
    }

    const nextY = qix.y + dy;
    if (isQixBlockedAt(game, qix.x, nextY)) {
      qix.vy = -qix.vy;
      blockedY = true;
    } else {
      qix.y = nextY;
      movedDistance += Math.abs(dy);
    }

    if ((blockedX && blockedY) || ((blockedX || blockedY) && scoreQixDirection(game, qix.x, qix.y, qix.vx, qix.vy) < 1)) {
      steerQixTowardOpenSpace(game, qix, speed);
    }
  }

  if (isQixBlockedAt(game, qix.x, qix.y)) {
    const open = nearestOpenCell(game, qix.x, qix.y);
    qix.x = open.x;
    qix.y = open.y;
    steerQixTowardOpenSpace(game, qix, speed);
  } else if (movedDistance < speed * 0.35) {
    steerQixTowardOpenSpace(game, qix, speed);
  }

  qix.x = clamp(qix.x, 1, COLS - 2);
  qix.y = clamp(qix.y, 1, ROWS - 2);
  normalizeQixVelocity(qix, speed);

  return qix;
}

function loseLife(game: Game, text: string): Game {
  const lives = game.lives - 1;
  return {
    ...game,
    player: { x: Math.floor(COLS / 2), y: ROWS - 1 },
    dir: { x: 0, y: 0 },
    slowMode: false,
    drawing: false,
    slowTrail: true,
    fuse: 0,
    trail: [],
    trailSet: new Set<string>(),
    qix: resetQix(game.level),
    lives,
    status: lives <= 0 ? "lost" : "paused",
    message: lives <= 0 ? "Game over. Premi R per ripartire" : `${text} Premi spazio per continuare`,
  };
}

function claimClosedArea(game: Game): Game {
  const claimed = copyClaimed(game.claimed);
  const slowClaimed = copyClaimed(game.slowClaimed);
  for (const p of game.trail) claimed[p.y][p.x] = true;
  if (game.slowTrail) {
    for (const p of game.trail) slowClaimed[p.y][p.x] = true;
  }

  const qx = clamp(Math.round(game.qix.x), 1, COLS - 2);
  const qy = clamp(Math.round(game.qix.y), 1, ROWS - 2);
  const qixAnchor = claimed[qy][qx] ? nearestOpenCellInGrid(claimed, new Set<string>(), qx, qy) : { x: qx, y: qy };
  const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false) as boolean[]);
  const queue: Point[] = [];
  if (!claimed[qixAnchor.y][qixAnchor.x]) {
    seen[qixAnchor.y][qixAnchor.x] = true;
    queue.push(qixAnchor);
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
  const gainedSet = new Set<string>();
  for (let y = 1; y < ROWS - 1; y += 1) {
    for (let x = 1; x < COLS - 1; x += 1) {
      if (!claimed[y][x] && !seen[y][x]) {
        claimed[y][x] = true;
        if (game.slowTrail) slowClaimed[y][x] = true;
        gainedSet.add(key(x, y));
        gained += 1;
      }
    }
  }

  const percent = areaPercent(claimed);
  const isCapturedSpark = (spark: Game["sparks"][number]) => {
    if (!isSparkBoundaryCell(claimed, spark.x, spark.y)) return true;
    return CARDINALS.some((dir) => gainedSet.has(key(spark.x + dir.x, spark.y + dir.y)));
  };
  const survivingSparks = game.sparks.filter((spark) => !isCapturedSpark(spark));
  const destroyedSparks = game.sparks.length - survivingSparks.length;
  const drawScore = (gained * 12 + game.trail.length * 5) * (game.slowTrail ? SLOW_DRAW_MULTIPLIER : 1);
  const score = game.score + drawScore + destroyedSparks * SPARK_CAPTURE_BONUS * game.level;
  return {
    ...game,
    claimed,
    slowClaimed,
    sparks: survivingSparks,
    trail: [],
    trailSet: new Set<string>(),
    drawing: false,
    slowTrail: true,
    fuse: 0,
    percent,
    score,
    status: percent >= TARGET_PERCENT ? "won" : game.status,
    message: percent >= TARGET_PERCENT
      ? `Livello ${game.level} completato! Premi N per il prossimo livello o R per ricominciare`
      : destroyedSparks > 0
        ? `${destroyedSparks} Sparx catturato${destroyedSparks > 1 ? "i" : ""}! Bonus ${destroyedSparks * SPARK_CAPTURE_BONUS * game.level}`
        : "",
  };
}

function resolveSparkCollisions(game: Game, sparkSweeps: Point[][]): Game | null {
  for (const sweptCells of sparkSweeps) {
    if (sweptCells.some((cell) => cell.x === game.player.x && cell.y === game.player.y)) {
      return loseLife(game, game.drawing ? "Uno Sparx ha colpito la penna." : "Uno Sparx ti ha raggiunto sul bordo.");
    }

    if (game.drawing) {
      const dangerCells = expandedCells(sweptCells, SPARK_TRAIL_TOUCH_RADIUS);
      for (const cell of dangerCells) {
        if (game.trailSet.has(key(cell.x, cell.y))) {
          return loseLife(game, "Uno Sparx ha colpito la tua scia.");
        }
      }
    }
  }

  return null;
}

function samePoint(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y;
}

function addPoint(a: Point, b: Point) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function oppositeDir(dir: Point) {
  return { x: -dir.x, y: -dir.y };
}

function perpendicularDirs(dir: Point) {
  return dir.x !== 0 ? [{ x: 0, y: 1 }, { x: 0, y: -1 }] : [{ x: 1, y: 0 }, { x: -1, y: 0 }];
}

function pointKey(point: Point) {
  return key(point.x, point.y);
}

function qixDistance(game: Game, point: Point) {
  return Math.hypot(point.x - game.qix.x, point.y - game.qix.y);
}

function sparkDistance(game: Game, point: Point) {
  if (game.sparks.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...game.sparks.map((spark) => manhattan(spark, point)));
}

function isAutoplayDangerous(game: Game, point: Point, drawing: boolean) {
  if (qixDistance(game, point) < AUTOPLAY_QIX_DANGER) return true;
  return drawing && sparkDistance(game, point) < AUTOPLAY_SPARK_DANGER;
}

function isAutoplayMoveLegal(game: Game, dir: Point) {
  if (dir.x === 0 && dir.y === 0) return false;
  const target = {
    x: clamp(game.player.x + dir.x, 0, COLS - 1),
    y: clamp(game.player.y + dir.y, 0, ROWS - 1),
  };
  if (samePoint(target, game.player)) return false;

  const targetClaimed = game.claimed[target.y]?.[target.x];
  const targetTrail = game.trailSet.has(pointKey(target));
  if (game.drawing) return !targetTrail || Boolean(targetClaimed);
  return Boolean(targetClaimed) || isInteriorCell(target.x, target.y);
}

function scoreAutoplayPoint(game: Game, point: Point, drawing: boolean) {
  const qix = qixDistance(game, point);
  const spark = sparkDistance(game, point);
  const dangerPenalty = isAutoplayDangerous(game, point, drawing) ? 120 : 0;
  return qix * 2.2 + Math.min(spark, 24) * 1.5 - dangerPenalty;
}

function findAutoplayClosingRoute(game: Game) {
  const queue: Array<{ point: Point; route: Point[]; trailSet: Set<string> }> = [
    { point: game.player, route: [], trailSet: new Set(game.trailSet) },
  ];
  const seen = new Set<string>([pointKey(game.player)]);
  let bestRoute: Point[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < queue.length; i += 1) {
    const node = queue[i];
    if (node.route.length >= AUTOPLAY_MAX_ROUTE) continue;

    for (const dir of CARDINALS) {
      const target = addPoint(node.point, dir);
      if (!isInsideGrid(target.x, target.y)) continue;
      const targetClaimed = Boolean(game.claimed[target.y]?.[target.x]);
      const targetKey = pointKey(target);
      if (!targetClaimed && (!isInteriorCell(target.x, target.y) || node.trailSet.has(targetKey))) continue;

      const route = [...node.route, dir];
      if (targetClaimed) {
        if (sparkDistance(game, target) < AUTOPLAY_SPARK_DANGER) continue;
        if (route.length > 1) return route;
        continue;
      }

      if (isAutoplayDangerous(game, target, true)) continue;
      const seenKey = `${targetKey}:${route.length}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);

      const nextTrailSet = new Set(node.trailSet);
      nextTrailSet.add(targetKey);
      const routeScore = scoreAutoplayPoint(game, target, true) - route.length * 0.7;
      if (routeScore > bestScore) {
        bestScore = routeScore;
        bestRoute = route;
      }
      queue.push({ point: target, route, trailSet: nextTrailSet });
    }
  }

  return bestRoute;
}

function simulateAutoplayClaimRoute(game: Game, entryDir: Point, sideDir: Point, depth: number, lateral: number) {
  const route: Point[] = [];
  const trailSet = new Set<string>();
  let point = game.player;
  let drawing = false;
  let minSafety = Number.POSITIVE_INFINITY;

  const tryStep = (dir: Point) => {
    const target = addPoint(point, dir);
    if (!isInsideGrid(target.x, target.y)) return false;
    const targetClaimed = Boolean(game.claimed[target.y]?.[target.x]);
    const targetKey = pointKey(target);
    if (!targetClaimed && (!isInteriorCell(target.x, target.y) || trailSet.has(targetKey))) return false;
    if (!targetClaimed && isAutoplayDangerous(game, target, true)) return false;

    route.push(dir);
    point = target;
    if (!targetClaimed) {
      drawing = true;
      trailSet.add(targetKey);
      minSafety = Math.min(minSafety, scoreAutoplayPoint(game, target, true));
      return true;
    }

    if (sparkDistance(game, target) < AUTOPLAY_SPARK_DANGER) return false;
    return drawing && route.length > 3;
  };

  for (let i = 0; i < depth; i += 1) {
    if (tryStep(entryDir) && game.claimed[point.y]?.[point.x]) return { route, minSafety };
  }

  for (let i = 0; i < lateral; i += 1) {
    if (tryStep(sideDir) && game.claimed[point.y]?.[point.x]) return { route, minSafety };
  }

  const backDir = oppositeDir(entryDir);
  for (let i = 0; i < depth + 8; i += 1) {
    if (!tryStep(backDir)) return null;
    if (game.claimed[point.y]?.[point.x]) return { route, minSafety };
  }

  return null;
}

function buildAutoplayClaimRoute(game: Game) {
  let bestRoute: Point[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  const maxDepth = game.percent < 25 ? 10 : 16;
  const maxLateral = game.percent < 25 ? 14 : 24;
  const step = game.percent < 25 ? 2 : 4;

  for (const entryDir of CARDINALS) {
    const entry = addPoint(game.player, entryDir);
    if (!isInteriorCell(entry.x, entry.y) || game.claimed[entry.y]?.[entry.x]) continue;
    if (isAutoplayDangerous(game, entry, true)) continue;

    for (const sideDir of perpendicularDirs(entryDir)) {
      for (let depth = 4; depth <= maxDepth; depth += step) {
        for (let lateral = 4; lateral <= maxLateral; lateral += step) {
          const candidate = simulateAutoplayClaimRoute(game, entryDir, sideDir, depth, lateral);
          if (!candidate) continue;
          const projectedArea = depth * lateral;
          const score = projectedArea * 0.18 + candidate.minSafety - candidate.route.length * 0.35 + Math.random() * 4;
          if (score > bestScore) {
            bestScore = score;
            bestRoute = candidate.route;
          }
        }
      }
    }
  }

  return bestRoute;
}

function chooseAutoplayBoundaryDir(game: Game) {
  let bestDir = ZERO_DIR;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const dir of CARDINALS) {
    if (!isAutoplayMoveLegal(game, dir)) continue;
    const target = addPoint(game.player, dir);
    if (!game.claimed[target.y]?.[target.x]) continue;
    const openNeighbors = CARDINALS.filter((nextDir) => {
      const next = addPoint(target, nextDir);
      return isInteriorCell(next.x, next.y) && !game.claimed[next.y]?.[next.x];
    }).length;
    const continuity = dir.x === game.dir.x && dir.y === game.dir.y ? 4 : 0;
    const internal = isInternalSparkBoundaryCell(game.claimed, target.x, target.y) ? 4 : 0;
    const score = scoreAutoplayPoint(game, target, false) + openNeighbors * 3 + continuity + internal + Math.random();
    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }

  return bestDir;
}

function chooseFallbackAutoplayDir(game: Game) {
  let bestDir = ZERO_DIR;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const dir of CARDINALS) {
    if (!isAutoplayMoveLegal(game, dir)) continue;
    const target = addPoint(game.player, dir);
    const closes = game.drawing && Boolean(game.claimed[target.y]?.[target.x]) ? 18 : 0;
    const score = scoreAutoplayPoint(game, target, game.drawing) + closes + Math.random();
    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }

  return bestDir;
}

function chooseAutoplayDir(game: Game, pilot: AutoPilotState) {
  const playerKey = pointKey(game.player);
  pilot.stuckTicks = playerKey === pilot.lastPlayerKey ? pilot.stuckTicks + 1 : 0;
  pilot.lastPlayerKey = playerKey;
  if (pilot.stuckTicks > 8) pilot.route = [];

  const nextRouteDir = pilot.route[0];
  if (nextRouteDir && isAutoplayMoveLegal(game, nextRouteDir)) {
    pilot.route = pilot.route.slice(1);
    return nextRouteDir;
  }

  pilot.route = [];
  if (game.drawing) {
    pilot.route = findAutoplayClosingRoute(game);
    const closingDir = pilot.route.shift();
    return closingDir ?? chooseFallbackAutoplayDir(game);
  }

  if (Math.random() < 0.24 || game.percent < 10) {
    pilot.route = buildAutoplayClaimRoute(game);
    const claimDir = pilot.route.shift();
    if (claimDir) return claimDir;
  }

  return chooseAutoplayBoundaryDir(game);
}

function applyAutoplay(game: Game, pilot: AutoPilotState) {
  if (!pilot.enabled) return game;

  if (game.status === "won" || game.status === "lost") {
    pilot.route = [];
    pilot.endTicks += 1;
    if (pilot.endTicks < AUTOPLAY_SETTLE_TICKS) return { ...game, dir: ZERO_DIR };
    const nextLevel = game.status === "won" ? game.level + 1 : 1;
    return { ...createInitialGame(nextLevel), status: "playing", message: "" };
  }

  pilot.endTicks = 0;
  const runningGame = game.status === "playing" ? game : { ...game, status: "playing" as GameStatus, message: "" };
  const dir = chooseAutoplayDir(runningGame, pilot);
  const target = addPoint(runningGame.player, dir);
  const startingTrail =
    !runningGame.drawing && isInsideGrid(target.x, target.y) && !runningGame.claimed[target.y]?.[target.x];
  const slowMode = runningGame.drawing ? runningGame.slowTrail : startingTrail && Math.random() < 0.45;
  return { ...runningGame, dir, slowMode };
}

function drawSpark(ctx: CanvasRenderingContext2D, pos: Point, phase: number) {
  const jitter = Math.sin(phase * 1.7) * 1.3;

  ctx.save();
  ctx.translate(pos.x * CELL + CELL / 2, pos.y * CELL + CELL / 2);
  ctx.rotate(phase * 0.45);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "#fb923c";
  ctx.shadowBlur = 18;

  ctx.strokeStyle = "#fed7aa";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-CELL * 0.78, jitter);
  ctx.lineTo(-CELL * 0.24, -CELL * 0.34);
  ctx.lineTo(CELL * 0.12, CELL * 0.24);
  ctx.lineTo(CELL * 0.72, -jitter);
  ctx.stroke();

  ctx.strokeStyle = "#f97316";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-CELL * 0.1, -CELL * 0.72);
  ctx.lineTo(CELL * 0.12, -CELL * 0.16);
  ctx.lineTo(-CELL * 0.06, CELL * 0.68);
  ctx.stroke();

  ctx.fillStyle = "#fff7ed";
  ctx.beginPath();
  ctx.arc(0, 0, CELL * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function stepGame(game: Game): Game {
  if (game.status !== "playing") return game;

  const previousQixPoint = { x: game.qix.x, y: game.qix.y };
  const nextQix = moveQix(game);

  const movedSparkResults = game.sparks.map((spark) => moveSpark(game, spark));
  const movedSparks = movedSparkResults.map((result) => result.spark);
  const sparkSweeps = movedSparkResults.map((result) => result.cells);
  let updated: Game = {
    ...game,
    moveTick: game.moveTick + 1,
    qix: nextQix,
    sparks: movedSparks,
  };

  const qixCell = { x: Math.round(nextQix.x), y: Math.round(nextQix.y) };
  if (qixTrailTouchCells(previousQixPoint, nextQix).some((cell) => updated.trailSet.has(key(cell.x, cell.y)))) {
    return loseLife(updated, "Il QIX ha tagliato la tua scia.");
  }

  const dir = updated.dir;
  const playerCanMove = !updated.slowMode || updated.moveTick % 2 === 0;
  if (updated.drawing && (dir.x === 0 && dir.y === 0)) {
    const fuse = updated.fuse + FUSE_SPEED;
    if (fuse >= Math.max(1, updated.trail.length)) return loseLife(updated, "La miccia ha raggiunto la tua penna.");
    updated = { ...updated, fuse };
  } else if (updated.fuse !== 0) {
    updated = { ...updated, fuse: 0 };
  }

  if ((dir.x !== 0 || dir.y !== 0) && playerCanMove) {
    const player = updated.player;
    const target = {
      x: clamp(player.x + dir.x, 0, COLS - 1),
      y: clamp(player.y + dir.y, 0, ROWS - 1),
    };

    if (target.x !== player.x || target.y !== player.y) {
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
        updated = {
          ...updated,
          player: target,
          slowTrail: updated.slowTrail && updated.slowMode,
          trail: [...updated.trail, target],
          trailSet,
        };
      } else if (targetClaimed) {
        updated = { ...updated, player: target };
      } else {
        const trailSet = new Set<string>([targetKey]);
        updated = {
          ...updated,
          drawing: true,
          slowTrail: updated.slowMode,
          fuse: 0,
          player: target,
          trail: [target],
          trailSet,
        };
      }
    }
  }

  if (updated.drawing && qixTrailTouchCells(previousQixPoint, nextQix).some((cell) => updated.trailSet.has(key(cell.x, cell.y)))) {
    return loseLife(updated, "Il QIX ha tagliato la tua scia.");
  }

  if (Math.abs(qixCell.x - updated.player.x) <= 1 && Math.abs(qixCell.y - updated.player.y) <= 1) {
    return loseLife(updated, "Il QIX ti ha colpito.");
  }

  const sparkCollision = resolveSparkCollisions(updated, sparkSweeps);
  if (sparkCollision) return sparkCollision;

  return updated;
}

function drawGame(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.clearRect(0, 0, COLS * CELL, ROWS * CELL);
  ctx.fillStyle = "#030712";
  ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (game.claimed[y][x]) {
        ctx.fillStyle =
          x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1
            ? "#0f766e"
            : game.slowClaimed[y]?.[x]
              ? "#7f1d1d"
              : "#0f3b64";
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  ctx.strokeStyle = "rgba(56, 189, 248, 0.18)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x += 4) {
    ctx.beginPath();
    ctx.moveTo(x * CELL, 0);
    ctx.lineTo(x * CELL, ROWS * CELL);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y += 4) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL);
    ctx.lineTo(COLS * CELL, y * CELL);
    ctx.stroke();
  }

  ctx.fillStyle = game.slowTrail && game.slowMode ? "#fb923c" : "#facc15";
  for (const p of game.trail) ctx.fillRect(p.x * CELL, p.y * CELL, CELL, CELL);
  if (game.drawing && game.fuse > 0) {
    const fuseCells = Math.min(game.trail.length, Math.ceil(game.fuse));
    ctx.fillStyle = "#ef4444";
    ctx.shadowColor = "#ef4444";
    ctx.shadowBlur = 16;
    for (let i = 0; i < fuseCells; i += 1) {
      const p = game.trail[i];
      ctx.fillRect(p.x * CELL, p.y * CELL, CELL, CELL);
    }
    ctx.shadowBlur = 0;
  }

  const q = game.qix;
  ctx.save();
  ctx.translate(q.x * CELL + CELL / 2, q.y * CELL + CELL / 2);
  ctx.rotate(Math.sin(q.phase) * 0.75);
  ctx.strokeStyle = "#fb7185";
  ctx.lineWidth = 3;
  ctx.shadowColor = "#fb7185";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  for (let i = 0; i < 9; i += 1) {
    const angle = q.phase + i * 0.9;
    const radius = CELL * (2.2 + Math.sin(q.phase * 1.7 + i) * 0.9);
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle * 1.3) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();

  for (const spark of game.sparks) {
    drawSpark(ctx, spark, spark.phase);
  }
  ctx.shadowBlur = 0;

  ctx.fillStyle = game.drawing ? (game.slowMode ? "#fb923c" : "#facc15") : "#67e8f9";
  ctx.shadowColor = game.drawing ? (game.slowMode ? "#fb923c" : "#facc15") : "#67e8f9";
  ctx.shadowBlur = 16;
  ctx.fillRect(game.player.x * CELL - 1, game.player.y * CELL - 1, CELL + 2, CELL + 2);
  ctx.shadowBlur = 0;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef(createInitialGame());
  const promptedScoreRef = useRef("");
  const pendingScoreRef = useRef<PendingScore | null>(null);
  const postGameIdleTicksRef = useRef(0);
  const pressedMoveKeysRef = useRef<string[]>([]);
  const attractRef = useRef<AttractState>({ phase: "title", ticks: 0 });
  const autoPilotRef = useRef<AutoPilotState>({
    enabled: false,
    route: [],
    endTicks: 0,
    stuckTicks: 0,
    lastPlayerKey: "",
  });
  const [hud, setHud] = useState(gameRef.current);
  const [highScores, setHighScores] = useState(loadHighScores);
  const [pendingScore, setPendingScore] = useState<PendingScore | null>(null);
  const [initials, setInitials] = useState("AAA");
  const [autoPlay, setAutoPlay] = useState(false);
  const [attract, setAttract] = useState<AttractState>(attractRef.current);
  const [credits, setCredits] = useState(0);

  const sync = () => setHud({ ...gameRef.current });
  const setAttractState = (next: AttractState) => {
    attractRef.current = next;
    setAttract(next);
  };

  const resetPromptState = () => {
    promptedScoreRef.current = "";
    pendingScoreRef.current = null;
    setPendingScore(null);
  };

  const directionFromPressedKeys = () => {
    for (let i = pressedMoveKeysRef.current.length - 1; i >= 0; i -= 1) {
      const dir = DIRS[pressedMoveKeysRef.current[i]];
      if (dir) return dir;
    }
    return ZERO_DIR;
  };

  const clearHeldControls = () => {
    pressedMoveKeysRef.current = [];
  };

  const syncHeldDirection = () => {
    gameRef.current = { ...gameRef.current, dir: directionFromPressedKeys() };
    sync();
  };

  const setAutoplayEnabled = (enabled: boolean) => {
    autoPilotRef.current = {
      ...autoPilotRef.current,
      enabled,
      route: [],
      endTicks: 0,
      stuckTicks: 0,
      lastPlayerKey: "",
    };
    setAutoPlay(enabled);
    if (enabled && (gameRef.current.status === "ready" || gameRef.current.status === "paused")) {
      gameRef.current = { ...gameRef.current, status: "playing", message: "" };
      sync();
    }
  };

  const insertCoin = () => {
    resetPromptState();
    clearHeldControls();
    setCredits((value) => value + 1);
    if (attractRef.current.phase === "off" && gameRef.current.status === "playing") return;

    setAutoplayEnabled(false);
    setAttractState({ phase: "off", ticks: 0 });
    gameRef.current = {
      ...createInitialGame(1),
      message: "Credito inserito. Premi R per iniziare",
    };
    sync();
  };

  const startGame = () => {
    resetPromptState();
    clearHeldControls();
    setAutoplayEnabled(false);
    setAttractState({ phase: "off", ticks: 0 });
    setCredits((value) => Math.max(0, value - 1));
    gameRef.current = {
      ...createInitialGame(1),
      status: "playing",
      message: "",
    };
    sync();
  };

  const enterAttractPhase = (phase: Exclude<AttractPhase, "off">) => {
    resetPromptState();
    clearHeldControls();
    setAttractState({ phase, ticks: 0 });

    if (phase === "demo") {
      gameRef.current = {
        ...createInitialGame(1),
        status: "playing",
        message: "",
      };
      setAutoplayEnabled(true);
      return;
    }

    setAutoplayEnabled(false);
    if (phase === "title") {
      gameRef.current = {
        ...createInitialGame(1),
        message: "",
      };
    } else {
      gameRef.current = { ...gameRef.current, status: "ready", dir: ZERO_DIR, message: "" };
    }
    sync();
  };

  const tickAttract = () => {
    const current = attractRef.current;
    if (current.phase === "off") return;

    const ticks = current.ticks + 1;
    if (current.phase === "title" && ticks >= ATTRACT_TITLE_TICKS) {
      enterAttractPhase("demo");
      return;
    }
    if (current.phase === "demo" && ticks >= ATTRACT_DEMO_TICKS) {
      enterAttractPhase("scores");
      return;
    }
    if (current.phase === "scores" && ticks >= ATTRACT_SCORES_TICKS) {
      enterAttractPhase("title");
      return;
    }

    setAttractState({ ...current, ticks });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.code === "KeyP") {
        event.preventDefault();
        setAttractState({ phase: "off", ticks: 0 });
        setAutoplayEnabled(!autoPilotRef.current.enabled);
        return;
      }
      if (event.code === "KeyR") {
        event.preventDefault();
        startGame();
        return;
      }
      if (event.code === "KeyN") {
        if (gameRef.current.status === "won") {
          resetPromptState();
          gameRef.current = createInitialGame(gameRef.current.level + 1);
          sync();
        }
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (attractRef.current.phase === "off" && gameRef.current.status === "playing") {
          gameRef.current = { ...gameRef.current, slowMode: true };
          sync();
          return;
        }
        insertCoin();
        return;
      }
      const dir = DIRS[event.code];
      if (dir) {
        event.preventDefault();
        if (attractRef.current.phase !== "off") return;
        if (autoPilotRef.current.enabled) setAutoplayEnabled(false);
        if (!pressedMoveKeysRef.current.includes(event.code)) {
          pressedMoveKeysRef.current = [...pressedMoveKeysRef.current, event.code];
        }
        const status = gameRef.current.status;
        if (status === "ready" || status === "paused") {
          gameRef.current = { ...gameRef.current, status: "playing", message: "", dir: directionFromPressedKeys() };
        } else if (status === "playing") {
          gameRef.current = { ...gameRef.current, dir: directionFromPressedKeys() };
        }
        sync();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.code === "Space" && attractRef.current.phase === "off" && gameRef.current.status === "playing") {
        event.preventDefault();
        gameRef.current = { ...gameRef.current, slowMode: false };
        sync();
        return;
      }
      if (DIRS[event.code]) {
        event.preventDefault();
        pressedMoveKeysRef.current = pressedMoveKeysRef.current.filter((code) => code !== event.code);
        if (attractRef.current.phase === "off" && !autoPilotRef.current.enabled) syncHeldDirection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (hud.status !== "lost" && hud.status !== "won") return;

    const promptKey = `${hud.status}:${hud.score}:${hud.level}:${hud.percent}`;
    if (promptedScoreRef.current === promptKey) return;
    promptedScoreRef.current = promptKey;

    if (qualifiesHighScore(highScores, hud.score)) {
      if (autoPlay) return;
      setInitials("AAA");
      const nextPendingScore = {
        score: hud.score,
        level: hud.level,
        percent: hud.percent,
        date: new Date().toISOString(),
      };
      pendingScoreRef.current = nextPendingScore;
      setPendingScore(nextPendingScore);
    }
  }, [autoPlay, highScores, hud.level, hud.percent, hud.score, hud.status]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawGame(ctx, gameRef.current);
    const timer = window.setInterval(() => {
      tickAttract();
      gameRef.current = applyAutoplay(gameRef.current, autoPilotRef.current);
      gameRef.current = stepGame(gameRef.current);
      if (
        attractRef.current.phase === "off" &&
        (gameRef.current.status === "lost" || gameRef.current.status === "won") &&
        !pendingScoreRef.current
      ) {
        postGameIdleTicksRef.current += 1;
        if (postGameIdleTicksRef.current >= POST_GAME_ATTRACT_TICKS) {
          postGameIdleTicksRef.current = 0;
          enterAttractPhase("title");
        }
      } else {
        postGameIdleTicksRef.current = 0;
      }
      (window as DebugWindow).__qixDebug = {
        game: gameRef.current,
        attract: attractRef.current,
        autoplay: {
          enabled: autoPilotRef.current.enabled,
          routeLength: autoPilotRef.current.route.length,
          stuckTicks: autoPilotRef.current.stuckTicks,
        },
      };
      drawGame(ctx, gameRef.current);
      setHud({ ...gameRef.current });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const statusText = hud.status === "won" ? "Vittoria" : hud.status === "lost" ? "Sconfitta" : hud.status === "paused" ? "Pausa" : hud.status === "ready" ? "Pronto" : "In gioco";
  const attractDuration =
    attract.phase === "title" ? ATTRACT_TITLE_TICKS : attract.phase === "demo" ? ATTRACT_DEMO_TICKS : ATTRACT_SCORES_TICKS;
  const attractSeconds = attract.phase === "off" ? 0 : Math.max(0, Math.ceil(((attractDuration - attract.ticks) * TICK_MS) / 1000));
  const modeText =
    attract.phase === "title" ? "Titolo" : attract.phase === "demo" ? "Demo" : attract.phase === "scores" ? "Classifica" : "Gioco";
  const submitHighScore = () => {
    if (!pendingScore) return;
    const nextScores = insertHighScore(highScores, {
      ...pendingScore,
      initials: normalizeInitials(initials),
    });
    saveHighScores(nextScores);
    setHighScores(nextScores);
    pendingScoreRef.current = null;
    setPendingScore(null);
  };

  return (
    <main className="min-h-screen bg-[#030712] text-cyan-50">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-cyan-300/20 pb-4">
          <div>
            <p className="font-mono text-sm uppercase tracking-[0.45em] text-cyan-300/75">arcade territory duel</p>
            <h1 className="font-mono text-4xl font-black tracking-tight text-white sm:text-6xl">QIX®-STYLE</h1>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-sm sm:grid-cols-3 xl:grid-cols-7">
            <span><b className="text-cyan-300">Livello</b> {hud.level}</span>
            <span><b className="text-cyan-300">Score</b> {hud.score}</span>
            <span><b className="text-cyan-300">Area</b> {hud.percent}%/{TARGET_PERCENT}%</span>
            <span><b className="text-cyan-300">Vite</b> {hud.lives}</span>
            <span><b className="text-cyan-300">Stato</b> {statusText}</span>
            <span><b className="text-cyan-300">Modo</b> {modeText}</span>
            <span><b className="text-cyan-300">Crediti</b> {credits}</span>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-6 py-6 lg:grid-cols-[1fr_310px]">
          <div className="relative overflow-hidden border border-cyan-300/35 bg-black shadow-[0_0_50px_rgba(34,211,238,0.18)]">
            <canvas
              ref={canvasRef}
              width={COLS * CELL}
              height={ROWS * CELL}
              className="block h-auto w-full [image-rendering:pixelated]"
              aria-label="Gioco arcade ispirato a QIX registrato"
            />
            {hud.message && attract.phase === "off" && (
              <div className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 border border-cyan-200/60 bg-slate-950/90 px-6 py-4 text-center font-mono text-sm uppercase tracking-widest text-cyan-100 shadow-[0_0_30px_rgba(103,232,249,0.25)]">
                {hud.message}
              </div>
            )}
            {attract.phase === "title" && (
              <div className="absolute inset-0 grid place-items-center bg-slate-950/90 px-6 text-center font-mono text-cyan-100">
                <div>
                  <p className="mb-4 text-sm uppercase tracking-[0.55em] text-cyan-300">arcade territory duel</p>
                  <h2 className="text-6xl font-black text-white sm:text-8xl">QIX®-STYLE</h2>
                  <p className="mt-5 text-lg uppercase tracking-widest text-cyan-100">Press Space To Insert Coin</p>
                  <p className="mt-2 text-sm uppercase tracking-widest text-cyan-300">R Start</p>
                  <p className="mt-8 text-xs uppercase tracking-widest text-cyan-100/55">Demo in {attractSeconds}</p>
                </div>
              </div>
            )}
            {attract.phase === "demo" && (
              <div className="absolute left-4 top-4 border border-amber-300/70 bg-black/80 px-3 py-2 font-mono text-xs font-black uppercase tracking-widest text-amber-200">
                Demo Play · Space Insert Coin · {attractSeconds}
              </div>
            )}
            {attract.phase === "scores" && (
              <div className="absolute inset-0 bg-slate-950/95 px-8 py-10 font-mono text-cyan-100">
                <div className="mx-auto flex h-full max-w-xl flex-col justify-center pt-6">
                  <p className="mb-2 text-center text-xs uppercase tracking-[0.4em] text-cyan-300">Hall of Fame</p>
                  <h2 className="mb-5 text-center text-3xl font-black uppercase text-white">High Scores</h2>
                  <ol className="mx-auto w-full max-w-md space-y-1.5 text-base">
                    {highScores.length === 0 ? (
                      <li className="text-center text-cyan-100/55">No Records</li>
                    ) : (
                      highScores.map((entry, index) => (
                        <li key={`${entry.initials}-${entry.score}-${entry.date}`} className="grid grid-cols-[3ch_5ch_1fr] gap-4">
                          <span className="text-cyan-300">{String(index + 1).padStart(2, "0")}</span>
                          <span className="font-black text-white">{entry.initials}</span>
                          <span className="text-right tabular-nums">{entry.score}</span>
                        </li>
                      ))
                    )}
                  </ol>
                  <p className="mt-8 text-center text-sm uppercase tracking-widest text-cyan-300">Space Insert Coin · R Start</p>
                  <p className="mt-2 text-center text-xs uppercase tracking-widest text-cyan-100/55">Title in {attractSeconds}</p>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-6 font-mono text-sm leading-6 text-cyan-100/80">
            <div>
              <h2 className="mb-2 text-xl font-black uppercase tracking-widest text-white">Come si gioca</h2>
              <p>
                Muoviti sui bordi sicuri, entra nell'arena e chiudi poligoni per conquistare territorio. Vinci al {TARGET_PERCENT}%.
              </p>
            </div>
            <div>
              <h3 className="mb-2 font-bold uppercase tracking-widest text-cyan-300">Comandi</h3>
              <p>Frecce o WASD: movimento</p>
              <p>Spazio: insert coin</p>
              <p>Spazio durante il gioco: slow draw</p>
              <p>R: start</p>
              <p>P: demo tecnica</p>
              <p>N: prossimo livello (quando completato)</p>
              <button
                className="mt-3 w-full border border-cyan-300/60 px-3 py-2 font-black uppercase tracking-widest text-cyan-100 hover:border-cyan-100 hover:text-white"
                type="button"
                onClick={() => setAutoplayEnabled(!autoPlay)}
              >
                {autoPlay ? "Stop Demo" : "Autoplay"}
              </button>
            </div>
            <div>
              <h3 className="mb-2 font-bold uppercase tracking-widest text-cyan-300">Pericoli</h3>
              <p>La forma rossa distrugge la tua scia. Gli Sparx arancioni pattugliano i bordi sicuri e valgono bonus se li intrappoli.</p>
            </div>
            <div>
              <h3 className="mb-2 font-bold uppercase tracking-widest text-cyan-300">Note</h3>
              <p className="text-xs leading-5 text-cyan-100/55">{LEGAL_NOTICE}</p>
            </div>
            <div>
              <h3 className="mb-2 font-bold uppercase tracking-widest text-cyan-300">High Score</h3>
              <ol className="space-y-1">
                {highScores.length === 0 ? (
                  <li className="text-cyan-100/50">---</li>
                ) : (
                  highScores.map((entry, index) => (
                    <li key={`${entry.initials}-${entry.score}-${entry.date}`} className="grid grid-cols-[2ch_4ch_1fr] gap-3">
                      <span className="text-cyan-300">{String(index + 1).padStart(2, "0")}</span>
                      <span className="text-white">{entry.initials}</span>
                      <span className="text-right tabular-nums">{entry.score}</span>
                    </li>
                  ))
                )}
              </ol>
            </div>
          </aside>
        </section>

        {pendingScore && (
          <div className="fixed inset-0 z-10 grid place-items-center bg-slate-950/80 px-4">
            <form
              className="w-full max-w-sm border border-cyan-200/60 bg-slate-950 px-6 py-5 text-center font-mono text-cyan-100 shadow-[0_0_35px_rgba(103,232,249,0.28)]"
              onSubmit={(event) => {
                event.preventDefault();
                submitHighScore();
              }}
            >
              <h2 className="mb-2 text-2xl font-black uppercase tracking-widest text-white">Nuovo Record</h2>
              <p className="mb-4 text-sm uppercase tracking-widest text-cyan-300">{pendingScore.score} Punti</p>
              <input
                autoFocus
                aria-label="Iniziali high score"
                className="mb-4 w-32 border border-cyan-300/60 bg-black px-3 py-2 text-center text-4xl font-black uppercase tracking-[0.3em] text-white outline-none focus:border-cyan-100"
                inputMode="text"
                maxLength={3}
                value={initials}
                onChange={(event) => {
                  setInitials(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3));
                }}
              />
              <button
                className="block w-full border border-cyan-300/70 bg-cyan-300 px-4 py-2 font-black uppercase tracking-widest text-slate-950 hover:bg-cyan-100"
                type="submit"
              >
                Salva
              </button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
