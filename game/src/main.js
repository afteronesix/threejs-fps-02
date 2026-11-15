// SANDLINE — main entry. Boots the renderer and every system, then runs a
// fixed 60 Hz simulation decoupled from rendering (accumulator, max 5 steps),
// so the game plays identically at any refresh rate. This file owns the
// wiring only: input -> player -> arsenal -> combat -> kills -> economy ->
// rounds -> HUD. Every system above it is replaceable without touching this
// loop.
//
// Capture mode: ?shot=combat|buy|plant|result&seed=N drives the REAL game to
// a real state (real purchases, the real 3 s plant channel, real kills),
// settles it, freezes the sim and sets window.__shotReady for the screenshot
// rig. No state is ever faked for a screenshot.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, clamp } from './util.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArsenal, WEAPONS } from './weapons.js';
import { createCombat } from './combat.js';
import { createBots } from './bots.js';
import { createEconomy } from './economy.js';
import { createBomb } from './bomb.js';
import { createRounds, WIN_REASONS } from './rounds.js';
import { createHud } from './hud.js';

const params = new URLSearchParams(window.location.search);
const SHOT = params.get('shot');
const SEED = Number(params.get('seed') || 7);
const FIXED_STEP = 1 / 60;

let started = false;
let frozen = false;
let spectateTarget = null;
let hiddenSpectate = null;
let lastFrame = performance.now();
let accumulator = 0;
let hudTimer = 0;
let dryFireAt = 0;
let mouseWasDown = false;
let shotNow = 0;

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('view') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(PALETTE.canvas, 30, 90);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 120);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const economy = createEconomy();
const bomb = createBomb(scene);
const rounds = createRounds();
const rng = mulberry32(SEED);

const player = createPlayer(world);
const arsenal = createArsenal(camera);
const combat = createCombat(scene, world);
const bots = createBots(scene, world, combat, rng);
const allBots = bots.bots;

const input = createInput(renderer.domElement, (locked) => {
  if (!locked && started && !SHOT && rounds.state.phase !== 'matchEnd' && !hud.buyMenuOpen()) {
    hud.showOverlay('PAUSED', 'Click to resume the match.', 'RESUME');
  }
});

// The player as a combat actor: same shape the bots have (id, team, alive,
// position, hitMeshes, chest, damage), so combat.js never special-cases it.
const playerActor = {
  id: 'player',
  name: 'YOU',
  team: 'A',
  group: null,
  hasBomb: false,
  get alive() { return player.state.alive; },
  get position() { return player.state.position; },
  get yaw() { return player.state.yaw; },
  groundSpeed() { return player.groundSpeed(); },
  hitMeshes: player.hitMeshes,
  chest: (() => { const v = new THREE.Vector3(); return () => v.set(player.state.position.x, player.state.position.y + 1.2, player.state.position.z); })(),
  damage(amount) {
    const killed = player.damage(amount);
    if (!killed) {
      hud.damageFlashOn();
      audio.hurt();
    }
    return killed;
  },
};
combat.register(playerActor);

function allActors() {
  return [playerActor, ...allBots];
}

function enemiesOf(team) {
  return team === 'A'
    ? allBots.filter((b) => b.team === 'B')
    : [...allBots.filter((b) => b.team === 'A'), playerActor];
}

function aliveCount(team) {
  const count = bots.aliveOf(team).length;
  return team === 'A' ? count + (player.state.alive ? 1 : 0) : count;
}

function handleKill(victim, killer, weapon, headshot) {
  if (victim.hasBomb) bomb.drop();
  hud.killfeedEntry(killer ? killer.name : 'WORLD', victim.name, headshot, weapon);
  if (killer) economy.onKill(killer.id);
  if (killer === playerActor) audio.kill();
  if (victim === playerActor) {
    spectateTarget = bots.aliveOf('A')[0] || null;
    hud.setSpectate(spectateTarget ? `SPECTATING ${spectateTarget.name} — wait for the next round` : 'YOU ARE DEAD — wait for the next round');
  }
}

// Every shot is heard (bots investigate the sound) and can mark a site under
// attack; only actor hits drive hitmarkers and the kill feed.
function handleShotResult(shooter, result, weaponName) {
  bots.hearShot(shooter.position.x, shooter.position.z, shooter.team);
  for (const site of Object.values(SITES)) {
    const d = Math.hypot(shooter.position.x - site.center.x, shooter.position.z - site.center.z);
    if (d < 12) bomb.underAttack = site.id;
  }
  if (!result || result.hit !== 'actor') return;
  if (result.killed) {
    handleKill(result.actor, shooter, weaponName, result.headshot);
  } else if (shooter === playerActor) {
    hud.hitMarker(false, result.headshot);
    audio.hit(result.headshot);
  }
}

const botContext = {
  phase: 'buy',
  bomb,
  player: playerActor,
  enemiesOf,
  onShot(shooter, result) {
    audio.enemyShoot();
    handleShotResult(shooter, result, WEAPONS[shooter.weapon].name);
  },
};

const shotOrigin = new THREE.Vector3();
const shotDir = new THREE.Vector3();

function playerShoot() {
  if (!player.state.alive || rounds.state.phase !== 'live') return;
  if (!arsenal.ready()) {
    if (arsenal.state.mags[arsenal.state.equipped] === 0 && performance.now() / 1000 > dryFireAt) {
      dryFireAt = performance.now() / 1000 + 0.3;
      audio.dryFire();
    }
    return;
  }
  if (!arsenal.takeRound()) return;
  const def = arsenal.def();
  arsenal.pullTrigger();
  player.recoil(def.recoil, (rng() - 0.5) * def.recoil * 0.4);
  audio.shoot(def.id);
  const spread = arsenal.spread(player.groundSpeed(), player.state.crouching);
  camera.getWorldDirection(shotDir);
  shotDir.x += (rng() - 0.5) * 2 * spread;
  shotDir.y += (rng() - 0.5) * 2 * spread;
  shotDir.normalize();
  shotOrigin.copy(camera.position);
  const result = combat.shoot(shotOrigin, shotDir, def, playerActor, rng);
  combat.fireFlash(shotOrigin);
  handleShotResult(playerActor, result, def.name);
}

function playerThrowGrenade(type) {
  if (!player.state.alive || rounds.state.phase !== 'live') return;
  if (!arsenal.throwGrenade(type)) return;
  camera.getWorldDirection(shotDir);
  shotOrigin.copy(camera.position);
  combat.throwGrenade(shotOrigin, shotDir, type, playerActor, (events) => {
    for (const event of events) {
      if (event.killed) handleKill(event.actor, playerActor, type === 'frag' ? 'Frag Grenade' : 'Smoke', false);
    }
  });
}

function buyItems() {
  return {
    items: [
      { id: 'rifle', key: '1', name: 'VK-47 Rifle', price: WEAPONS.rifle.price, owned: arsenal.state.owned.rifle },
      { id: 'smg', key: '2', name: 'K9 SMG', price: WEAPONS.smg.price, owned: arsenal.state.owned.smg },
      { id: 'frag', key: '3', name: 'Frag Grenade', price: 300, owned: false },
      { id: 'smoke', key: '4', name: 'Smoke Grenade', price: 300, owned: false },
      { id: 'armor', key: '5', name: 'Kevlar + Helmet', price: 650, owned: player.state.armor >= 100 },
    ],
    money: economy.get('player'),
  };
}

function buyItem(id) {
  if (!economy.buyPlayer(id)) { audio.denied(); return; }
  if (id === 'armor') {
    player.state.armor = 100;
    arsenal.buy('armor');
  } else {
    arsenal.buy(id);
  }
  audio.buy();
  refreshBuyMenu();
  hud.setMoney(economy.get('player'));
}

function refreshBuyMenu() {
  const { items, money } = buyItems();
  hud.showBuyMenu(items, money, buyItem);
}

function openBuyMenu() {
  refreshBuyMenu();
  input.releaseLock();
}

function closeBuyMenu() {
  if (!hud.buyMenuOpen()) return;
  hud.hideBuyMenu();
  if (started) input.requestLock();
}

function startRound() {
  player.reset(SPAWNS.A[0][0], SPAWNS.A[0][1], 0);
  bots.reset(SPAWNS);
  bots.buyAll(economy);
  bomb.reset(playerActor);
  arsenal.refill();
  spectateTarget = null;
  if (hiddenSpectate) { hiddenSpectate.group.visible = true; hiddenSpectate = null; }
  hud.setSpectate('');
  hud.hideBanner();
  hud.buildRosters(
    ['YOU', ...allBots.filter((b) => b.team === 'A').map((b) => b.name)],
    allBots.filter((b) => b.team === 'B').map((b) => b.name),
  );
}

function startMatch() {
  economy.reset();
  player.state.armor = 0;
  rounds.startMatch();
  startRound();
  hud.hideOverlay();
}

function step(dt, now) {
  const phase = rounds.state.phase;
  const live = phase === 'live';
  const keys = input.state.keys;

  // Look deltas are drained every frame even when dead, so nothing piles up.
  const look = input.takeLook();
  if (!SHOT && started && !hud.buyMenuOpen() && player.state.alive) {
    player.step(dt, keys);
    if (input.state.locked) player.look(look.x, look.y);
    // Semi-auto guns fire on the mouse edge, autos while held.
    const mouseDown = input.state.firing;
    const mouseEdge = mouseDown && !mouseWasDown;
    mouseWasDown = mouseDown;
    if (live && (arsenal.def().auto ? mouseDown : mouseEdge)) playerShoot();
    if (input.wasPressed('KeyR') && arsenal.reload()) audio.reload();
    if (input.wasPressed('Digit1')) arsenal.switchTo('pistol');
    if (input.wasPressed('Digit2')) arsenal.switchTo('rifle');
    if (input.wasPressed('Digit3')) arsenal.switchTo('smg');
    if (input.wasPressed('KeyG')) playerThrowGrenade('frag');
    if (input.wasPressed('KeyF')) playerThrowGrenade('smoke');
    // Planting: hold E in a site while carrying the bomb; releasing E or
    // leaving the site breaks the channel and its progress is lost.
    if (bomb.canPlant(playerActor) && keys.has('KeyE')) {
      if (!bomb.channel) {
        bomb.startPlant(playerActor, () => {});
        audio.plant();
      }
    } else if (bomb.channel && bomb.channel.actor === playerActor) {
      bomb.cancelChannel(playerActor);
    }
    // Pick up a dropped bomb by walking over it.
    if (bomb.state === 'dropped') {
      const d = Math.hypot(player.state.position.x - bomb.position.x, player.state.position.z - bomb.position.z);
      if (d < 1.2) bomb.pickup(playerActor);
    }
  }
  if (!SHOT && input.wasPressed('KeyB')) {
    if (hud.buyMenuOpen()) closeBuyMenu();
    else if (phase === 'buy') openBuyMenu();
  }
  if (!SHOT && hud.buyMenuOpen()) {
    const buyKeys = { Digit1: 'rifle', Digit2: 'smg', Digit3: 'frag', Digit4: 'smoke', Digit5: 'armor' };
    for (const [code, id] of Object.entries(buyKeys)) {
      if (input.wasPressed(code)) buyItem(id);
    }
  }
  input.endFrame();

  arsenal.step(dt);
  if (live || phase === 'buy') {
    botContext.phase = phase;
    bots.step(dt, now, botContext);
  }
  bomb.step(dt, now, {
    onPlanted(site, actor) {
      economy.onPlant(actor.id);
      bomb.underAttack = site;
      audio.plant();
    },
    onBeep() { audio.beep(); },
    onDefused() { audio.defuse(); },
    onExploded() {
      combat.detonate(bomb.position);
      audio.explosion();
    },
  });
  rounds.step(dt, { aliveA: aliveCount('A'), aliveB: aliveCount('B'), bomb }, {
    onRoundLive() { closeBuyMenu(); },
    onRoundEnd(winner, reason) {
      const payouts = economy.onRoundEnd(winner);
      const won = winner === 'A';
      hud.showBanner(
        won ? 'ROUND WON' : 'ROUND LOST',
        WIN_REASONS[reason] || reason,
        won ? `+$${payouts.win} team bonus` : `+$${payouts.loss} team bonus`,
      );
      if (won) audio.roundWin(); else audio.roundLose();
    },
    onNextRound() { startRound(); },
    onMatchEnd(winner) {
      const won = winner === 'A';
      hud.showOverlay(
        winner ? (won ? 'MATCH WON' : 'MATCH LOST') : 'MATCH DRAWN',
        `Final score ${rounds.state.scoreA} — ${rounds.state.scoreB}. First to 4 rounds takes the match.`,
        'PLAY AGAIN',
      );
      input.releaseLock();
    },
  });
  combat.step(dt, now);

  // Refresh world matrices every sim step: the raycasts in combat.js and in
  // bot vision read matrixWorld, and the renderer only updates it when it
  // draws — during the capture settle (no renders) the bots' hitboxes would
  // otherwise sit at their spawn matrices and no shot could hit them.
  scene.updateMatrixWorld();

  // HUD: cheap every frame, expensive (rosters, minimap) four times a second.
  hud.setHealth(player.state.health, player.state.armor);
  hud.setAmmo(arsenal.state.mags[arsenal.state.equipped], arsenal.state.reserves[arsenal.state.equipped], arsenal.def().name);
  hud.setGrenades(arsenal.state.grenades.frag, arsenal.state.grenades.smoke);
  hud.setMoney(economy.get('player'));
  const timer = rounds.displayTime(bomb);
  hud.setTimer(timer.label, timer.value);
  hud.setScore(rounds.state.scoreA, rounds.state.scoreB, rounds.state.round);
  if (bomb.state === 'planted') {
    const defusing = bomb.channel?.type === 'defuse';
    hud.setBombStatus(
      defusing ? `DEFUSE IN PROGRESS ${Math.round(bomb.channel.progress * 100)}%` : `BOMB PLANTED — SITE ${bomb.site} ${Math.ceil(bomb.timerLeft)}s`,
      true,
    );
  } else if (bomb.state === 'carried' && bomb.carrier === playerActor) {
    hud.setBombStatus('YOU CARRY THE BOMB — PLANT AT SITE A OR B', false);
  } else if (bomb.channel?.type === 'plant') {
    hud.setBombStatus(`PLANTING ${Math.round(bomb.channel.progress * 100)}%`, false);
  } else if (bomb.state === 'dropped') {
    hud.setBombStatus('BOMB DROPPED — PICK IT UP', true);
  } else {
    hud.setBombStatus('', false);
  }
  let hint = '';
  if (bomb.canPlant(playerActor)) hint = 'HOLD E TO PLANT THE BOMB';
  else if (phase === 'buy' && !hud.buyMenuOpen()) hint = 'PRESS B TO BUY — ROUND STARTS SOON';
  else if (player.state.alive && arsenal.state.mags[arsenal.state.equipped] === 0) hint = 'PRESS R TO RELOAD';
  hud.setHint(hint);
  hud.setCrosshairGap(6 + arsenal.spread(player.groundSpeed(), player.state.crouching) * 1200);

  hudTimer += dt;
  if (hudTimer >= 0.25) {
    hudTimer = 0;
    hud.setRoster('A', 0, player.state.health, player.state.alive);
    allBots.filter((b) => b.team === 'A').forEach((b, i) => hud.setRoster('A', i + 1, b.health, b.alive));
    allBots.filter((b) => b.team === 'B').forEach((b, i) => hud.setRoster('B', i, b.health, b.alive));
    hud.drawMinimap(world, SITES, allActors(), bomb, player.state);
  }

  // Camera: first person, or spectating a living teammate after death. The
  // spectated bot's own body is hidden from the camera (its hitboxes still
  // work: the raycaster tests invisible meshes), so the view is its eyes.
  if (player.state.alive) {
    if (hiddenSpectate) { hiddenSpectate.group.visible = true; hiddenSpectate = null; }
    camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
    camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
  } else if (spectateTarget && spectateTarget.alive) {
    if (hiddenSpectate !== spectateTarget) {
      if (hiddenSpectate) hiddenSpectate.group.visible = true;
      hiddenSpectate = spectateTarget;
      spectateTarget.group.visible = false;
    }
    camera.position.set(spectateTarget.position.x, spectateTarget.position.y + 1.55, spectateTarget.position.z);
    camera.rotation.set(0, spectateTarget.yaw, 0, 'YXZ');
  }
}

function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs / 1000;
  if (frozen) { renderer.render(scene, camera); return; }
  let dt = (nowMs - lastFrame) / 1000;
  lastFrame = nowMs;
  // Before the first Deploy the scene renders frozen behind the overlay.
  if (!started) { renderer.render(scene, camera); return; }
  if (dt > 0.25) dt = 0.25;
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    step(FIXED_STEP, now);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (steps === 5) accumulator = 0;
  renderer.render(scene, camera);
}

// ---- Capture mode: drive the real game to a real state, then freeze. ----
function settle(steps) {
  for (let i = 0; i < steps; i += 1) {
    shotNow += FIXED_STEP;
    step(FIXED_STEP, shotNow);
  }
}

function settleUntil(steps, done) {
  for (let i = 0; i < steps; i += 1) {
    shotNow += FIXED_STEP;
    step(FIXED_STEP, shotNow);
    if (done()) return true;
  }
  return false;
}

function syncCameraToPlayer() {
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
}

function aimAt(target) {
  const eye = new THREE.Vector3(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  const dir = target.chest().sub(eye).normalize();
  player.state.yaw = Math.atan2(-dir.x, -dir.z);
  player.state.pitch = Math.asin(clamp(dir.y, -1, 1));
  syncCameraToPlayer();
}

// Reposition without healing or reviving: health, armour and life stay as the
// sim left them; only the hitboxes are re-synced to the new position.
function teleport(x, z, yaw) {
  player.state.position.set(x, 0, z);
  player.state.velocity.set(0, 0, 0);
  player.state.yaw = yaw;
  player.state.pitch = 0;
  player.syncHitbox();
  syncCameraToPlayer();
}

function forceLive(seconds) {
  rounds.state.phase = 'live';
  rounds.state.timeLeft = seconds;
}

function grantAndEquip() {
  economy.grant('player', 4000);
  for (const id of ['rifle', 'armor', 'frag', 'smoke']) {
    if (economy.buyPlayer(id)) {
      if (id === 'armor') {
        player.state.armor = 100;
        arsenal.buy('armor');
      } else arsenal.buy(id);
    }
  }
  arsenal.switchTo('rifle');
}

function placeBot(bot, x, z, state) {
  bot.position.set(x, 0, z);
  bot.state = state;
  bot.holdPoint = { x, z };
  bot.target = null;
  bot.lastKnown = null;
}

function setupShot(name) {
  startMatch();
  started = true;
  hud.hideOverlay();
  if (name === 'buy') {
    // Buy phase with the menu open: real prices, real $800, real roster.
    openBuyMenu();
    settle(20);
  } else if (name === 'combat') {
    grantAndEquip();
    forceLive(84);
    player.reset(0, 12, 0);
    // Two defenders mid-lane, in the player's line of sight.
    placeBot(allBots[4], -1.5, 2, 'hold');
    placeBot(allBots[5], 2.5, -2, 'hold');
    settle(25); // weapon switch takes 0.35 s; the rifle must be ready to fire
    aimAt(allBots[4]);
    for (let i = 0; i < 3; i += 1) { playerShoot(); settle(8); }
    settle(12); // the kill falls; the second defender returns fire
    aimAt(allBots[5]);
    playerShoot();
    settle(2);
  } else if (name === 'plant') {
    grantAndEquip();
    forceLive(90);
    // Plant at site A through the real 3 s channel.
    player.reset(SITES.A.center.x, SITES.A.center.z, 0);
    bomb.startPlant(playerActor, () => {});
    settle(200);
    // Fall back to the site's open east side — a clear line to the bomb —
    // and watch it; one defender defuses.
    teleport(-12, -12, 0.6);
    const aliveB = allBots.filter((b) => b.team === 'B' && b.alive);
    const defuser = aliveB[0];
    const cover = aliveB[1];
    if (defuser) {
      placeBot(defuser, bomb.position.x + 0.8, bomb.position.z + 0.8, 'hold');
      bomb.startDefuse(defuser, () => {});
    }
    if (cover) placeBot(cover, -6, -14, 'hold');
    if (defuser) aimAt(defuser);
    settle(120);
  } else if (name === 'result') {
    grantAndEquip();
    forceLive(95);
    player.reset(SITES.A.center.x, SITES.A.center.z, 0);
    bomb.startPlant(playerActor, () => {});
    settle(200);
    // Let the round play out to the bomb's 35 s fuse, then stop on the banner.
    settleUntil(2100, () => rounds.state.phase === 'end');
    if (player.state.alive) teleport(-12, -12, 0.6);
    settle(2);
  }
  // One last step with the HUD timers forced, so rosters and the minimap are
  // current in the frozen frame, then render twice and freeze the sim.
  hudTimer = 1;
  settle(1);
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  frozen = true;
  window.__shotReady = true;
  window.__shotState = {
    phase: rounds.state.phase,
    winner: rounds.state.winner,
    reason: rounds.state.reason,
    scoreA: rounds.state.scoreA,
    scoreB: rounds.state.scoreB,
    bomb: bomb.state,
    channel: bomb.channel ? { type: bomb.channel.type, actor: bomb.channel.actor?.name || null, progress: Math.round(bomb.channel.progress * 100) } : null,
    botsB: allBots.filter((b) => b.team === 'B').map((b) => ({ name: b.name, alive: b.alive, x: +b.position.x.toFixed(1), z: +b.position.z.toFixed(1), state: b.state })),
    playerAlive: player.state.alive,
    playerHealth: Math.round(player.state.health),
    aliveA: aliveCount('A'),
    aliveB: aliveCount('B'),
  };
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.onPlay(() => {
  audio.unlock();
  if (rounds.state.phase === 'matchEnd') startMatch();
  started = true;
  hud.hideOverlay();
  input.requestLock();
});

// Exposed for the capture rig's assertions.
window.__game = {
  get phase() { return rounds.state.phase; },
  get score() { return [rounds.state.scoreA, rounds.state.scoreB]; },
  get bomb() { return bomb.state; },
  get playerAlive() { return player.state.alive; },
  get aliveA() { return aliveCount('A'); },
  get aliveB() { return aliveCount('B'); },
};

if (SHOT) {
  try {
    setupShot(SHOT);
  } catch (error) {
    window.__shotError = String((error && error.stack) || error);
    throw error;
  }
} else {
  startMatch();
  hud.showOverlay(
    'SANDLINE',
    'Attackers plant the bomb at site A or B. Defenders stop them. First to 4 rounds wins. WASD move, mouse aim, click fire, R reload, E plant, B buy, G frag, F smoke, Shift walk, Ctrl crouch.',
    'DEPLOY',
  );
}
requestAnimationFrame(frame);
