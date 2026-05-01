# QIX®-STYLE

Arcade territory duel inspired by the classic Qix formula, built as a modern browser game with React, Vite, Canvas, a standalone HTML export, PWA assets, high scores, and cabinet-style attract mode.

## Play

Open `qix-style-standalone.html` directly in a browser. 

Published web version:

- Main game: `https://giuseppelevibo.github.io/QIX_LIKE/`
- Recommended install/open link for the hosted PWA: `https://giuseppelevibo.github.io/QIX_LIKE/qix-style-standalone.html`

The game starts in cabinet attract mode:

- Title screen: about 10 seconds
- Demo autoplay: about 20 seconds
- High scores: about 10 seconds
- Then the loop repeats

## Controls

- `Space`: insert coin
- `R`: start
- Arrow keys or `WASD`: move while held
- `Space` during play: slow draw
- `N`: next level after completing one
- `P`: technical autoplay toggle

Slow draw is slower, colors captured areas red, and awards double capture points. If the marker stops while drawing, a fuse burns along the trail toward the player.

## Features

- Canvas arcade playfield
- Qix-like territory capture
- Sparx edge enemies
- Slow draw and fuse mechanics
- Spark capture bonus
- 3-letter high-score table stored in `localStorage`
- Cabinet attract mode
- Autoplay demo/tester
- Standalone single HTML build
- PWA manifest, icon, and service worker assets
- **7 Power-ups & Threats system** (see Power-ups section below)

## Power-ups & Threats

The playfield spawns various items during gameplay that provide powerful effects or dangerous hazards:

### Power-ups (Beneficial)

**🪙 COINS**
- Most common drop
- Grants **100 points** on pickup
- Safe to collect, purely for score

**🛡️ SHIELD**
- Blue protective barrier
- Protects the player from one collision with QIX or Sparx
- Active for ~8 seconds
- Can be stacked (pickup another to extend protection)

**🚀 ROCKET** (Speed-Up)
- Red/orange speed boost
- Increases player movement speed by 40%
- Active for ~6 seconds
- Allows faster territory capture but requires better control

**💚 1-UP** (Extra Life)
- Green cross with upward arrow
- Grants one additional life
- Critical for surviving later levels

**⬇️ SLOW**
- Purple down-arrow icon
- Slows player movement to 60% of normal speed
- Active for ~8 seconds
- Tactical penalty—can be avoided if detected early
- Useful for precision drawing in tight spaces (or risky near enemies)

### Threats (Hazardous)

**⚡ FAST_MONSTER** (Enemy Threat)
- Red spiky circle with white center
- Accelerates all Sparx enemies by 40%
- Active for ~6 seconds
- Dangerous! Avoid or stay on captured territory

**💣 BOMB** (Destructive Threat)
- Black sphere with red/yellow fuse
- Explodes if captured in a claimed area
- **4-cell blast radius**: destroys claimed territory within the explosion zone
- **Kills the player** if within 4 cells of the explosion (unless shielded)
- Can also destroy an active shield
- Creates strategic risk—careless territory claims near bombs cause losses

## Item Mechanics

- Items spawn randomly in unclaimed space at regular intervals
- Maximum of 5 items can exist on-screen simultaneously
- Each item has a ~30-second lifespan before disappearing
- Pickup distance: 1.5 cells
- Spawn weights (probability distribution):
  - COINS: 30%
  - SHIELD: 15%
  - ROCKET: 15%
  - 1-UP: 10%
  - SLOW: 10%
  - FAST_MONSTER: 10%
  - BOMB: 10%

## Scoring

- **Captured area**: 10 points per cell (normal) / **20 points per cell (slow draw)**
- **Trail bonus**: 5 points per trail cell
- **Destroyed Sparx**: 2,500 + (500 × level) points per enemy
- **Coins**: 100 points

Slow draw (holding `Space` while drawing) doubles area score but slows movement—risk vs. reward!

## Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build:

```bash
npm run build
```

The Vite build is written to `dist/`. The standalone file in the project root is generated from the built `dist/index.html`.

## Repository Notes

Keep these in the repository:

- `src/`
- `public/`
- `index.html`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `vite.config.ts`
- root standalone assets: `qix-style-standalone.html`, `standalone.manifest.webmanifest`, `sw.js`, `icon.svg`

Do not commit:

- `node_modules/`
- `dist/`
- local `.env` files

## Legal Notice

QIX® is a registered trademark of TAITO CORPORATION. This project is an independent tribute and is not affiliated with, sponsored by, or endorsed by TAITO CORPORATION.

The source code in this repository is original project code. If you publish this game publicly, consider using an original title and describing it as a tribute or Qix-inspired game.
