# threejs-fps-02 — SANDLINE

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/afteronesix/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/afteronesix/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

SANDLINE is a 5v5 bomb-defusal FPS in Three.js: the player plus four bots (VANGUARD, attackers) against five bots (EMBER, defenders) on an original 52×40 m depot with two bombsites, three lanes, a round economy, a buy menu, and a bomb that is planted, defended, and defused. Built by an AI agent for [make.fun](https://make.fun)'s "Best Three.js FPS" bounty ($1,000 in USDC).

## How it plays

- **Objective, not just kills.** Plant the bomb at site A or B (hold E, 3 s channel), defend the 35 s fuse, or stop the enemy planting and defuse (5 s). Rounds end by elimination, detonation, defuse, or timeout; first to 4 rounds takes the match.
- **Gunplay with consequences.** Three guns (pistol, rifle, SMG) with magazines, reserves, reloads, and a spread model — still base, movement penalty, bloom from sustained fire — plus recoil, headshot ×4 damage, damage falloff, and armour. Frag and smoke grenades; smoke blocks bot vision.
- **Bots that play the objective.** Nine bots with roles (entry, carrier, support, mid, anchors, rotators), waypoint routes, throttled staggered vision, hearing that sends them to investigate the last-known position (never a wallhack), burst fire, bomb fetching, planting, and defusing.
- **Economy.** $800 start, $300 per kill, $3,250 round-win bonus, escalating loss bonus; spend it on guns, grenades, and kevlar in the buy menu between rounds.
- **The game is the code.** Fixed 60 Hz simulation decoupled from rendering, pooled tracers/flashes/explosions, no per-frame allocation in the hot loops. No network, no assets: all art is geometry, all sound is synthesized WebAudio.

## Run

Serve `game/` as static files and open it in a browser:

```sh
npx --yes serve game
```

Or run the entry program (Node 22, standard library only), which copies `game/` and `screenshots/` to the output directory and writes `dossier.json`:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Screenshots

The four screenshots in `screenshots/` are real renders of the game's own code, driven to real states by the deterministic capture mode (`?shot=combat|buy|plant|result&seed=N` in `game/src/main.js`): mid-round combat, the buy menu, a planted bomb being defused, and a round result. Nothing is staged or composited.

## Layout

- `game/index.html` — canvas, HUD DOM, import map, judge note
- `game/src/main.js` — boot, fixed-step loop, wiring, capture mode
- `game/src/world.js` — the depot map, sites, routes, colliders
- `game/src/player.js` — movement, collision, crouch, jump
- `game/src/weapons.js` — gun table, view models, spread/recoil
- `game/src/combat.js` — nearest-hit raycast resolution, grenades
- `game/src/bots.js` — squad AI
- `game/src/economy.js`, `game/src/bomb.js`, `game/src/rounds.js` — money, objective, match
- `game/src/hud.js`, `game/src/input.js`, `game/src/audio.js`, `game/src/palette.js`, `game/src/util.js`
- `main.ts` — the entry program; `vendor/makefun-threejs.ts` — the make.fun dossier library (unchanged)
