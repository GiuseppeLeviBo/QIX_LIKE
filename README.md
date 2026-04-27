# QIX®-STYLE

Arcade territory duel inspired by the classic Qix formula, built as a modern browser game with React, Vite, Canvas, a standalone HTML export, PWA assets, high scores, and cabinet-style attract mode.

## Play

Open `qix-style-standalone.html` directly in a browser.

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
- root standalone/PWA assets: `qix-style-standalone.html`, `manifest.webmanifest`, `sw.js`, `icon.svg`

Do not commit:

- `node_modules/`
- `dist/`
- local `.env` files

## Legal Notice

QIX® is a registered trademark of TAITO CORPORATION. This project is an independent tribute and is not affiliated with, sponsored by, or endorsed by TAITO CORPORATION.

The source code in this repository is original project code. If you publish this game publicly, consider using an original title and describing it as a tribute or Qix-inspired game.
