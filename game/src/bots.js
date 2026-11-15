// Bots: two squads of five (the player plus four VANGUARD bots against five
// EMBER bots). Each bot is a small state machine — MOVE along its route, HOLD a
// position, ENGAGE a visible enemy, INVESTIGATE a sound, PLANT or DEFUSE the
// bomb — with roles that differ by team: entry, carrier, support and mid for
// the attackers; anchors, mid and rotators for the defenders. Vision is a
// real line-of-sight test against the map (no seeing through walls), throttled
// and staggered so ten bots do not raycast every frame; hearing turns a
// gunshot into a last-known position to investigate, never omniscience; smoke
// blocks vision outright. Shooting is the same hitscan combat the player uses,
// with spread that grows with distance and target speed.
import * as THREE from 'three';
import { PALETTE, TEAMS } from './palette.js';
import { ROUTES, SITES, NAV_NODES, NAV_EDGES } from './world.js';
import { scratch, distXZ, yawTo, angleDelta, clamp } from './util.js';
import { WEAPONS } from './weapons.js';

const NAMES = {
  A: ['JUNO', 'KADE', 'MIRA', 'ROOK'],
  B: ['VEX', 'ONYX', 'SABLE', 'FANG', 'HAVOC'],
};
const BOT_SPEED = 4.2;
const HEAR_RADIUS = 22;
const SEE_RANGE = 45;
const REACT_MIN = 0.25;
const REACT_MAX = 0.45;

export function createBots(scene, world, combat, random) {
  const bots = [];
  const sharedGeometries = {
    torso: new THREE.BoxGeometry(0.55, 0.78, 0.32),
    head: new THREE.BoxGeometry(0.28, 0.26, 0.28),
    legs: new THREE.BoxGeometry(0.5, 0.62, 0.3),
    gun: new THREE.BoxGeometry(0.07, 0.09, 0.55),
  };
  const materials = {
    A: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teamA), roughness: 0.6 }),
    B: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teamB), roughness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 }),
    head: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 }),
  };

  function buildBody(team) {
    const group = new THREE.Group();
    const legs = new THREE.Mesh(sharedGeometries.legs, materials.dark);
    legs.position.y = 0.31;
    legs.userData.part = 'legs';
    const torso = new THREE.Mesh(sharedGeometries.torso, materials[team]);
    torso.position.y = 1.0;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(sharedGeometries.head, materials.head);
    head.position.y = 1.53;
    head.userData.part = 'head';
    const gun = new THREE.Mesh(sharedGeometries.gun, materials.dark);
    gun.position.set(0.2, 1.1, -0.3);
    group.add(legs, torso, head, gun);
    group.traverse((mesh) => { if (mesh.isMesh) { mesh.castShadow = true; } });
    scene.add(group);
    return { group, hitMeshes: [torso, head, legs] };
  }

  function makeBot(team, index, role, routeKey) {
    const { group, hitMeshes } = buildBody(team);
    const bot = {
      id: `${team}${index}`,
      name: NAMES[team][index],
      team,
      role,
      routeKey,
      slot: index, // team-local spawn slot; team A slots 1-4 (0 is the player)
      group,
      hitMeshes,
      position: group.position,
      yaw: team === 'A' ? 0 : Math.PI, // attackers face north, defenders south
      health: 100,
      armor: 0,
      alive: true,
      state: 'buy',
      route: [],
      waypoint: 0,
      target: null,
      reactAt: 0,
      burstLeft: 0,
      nextShotAt: 0,
      perceiveAt: index * 0.03,
      lastKnown: null,
      stuckAt: 0,
      lastX: 0,
      lastZ: 0,
      fall: 0,
      weapon: 'pistol',
      money: 800,
      hasBomb: false,
      holdPoint: null,
      channel: null, // 'plant' | 'defuse' while channelling
      nav: null, // { path: [[x, z]...], i, tx, tz } for directed movement
    };
    for (const mesh of hitMeshes) mesh.userData.actor = bot;
    bot.chest = () => scratch.v4.set(bot.position.x, bot.position.y + 1.1, bot.position.z);
    bot.eye = () => scratch.v4.set(bot.position.x, bot.position.y + 1.5, bot.position.z);
    bot.damage = (amount, attacker) => {
      if (!bot.alive) return false;
      let rest = amount;
      if (bot.armor > 0) {
        const absorbed = Math.min(bot.armor, rest * 0.5);
        bot.armor -= absorbed;
        rest -= absorbed;
      }
      bot.health -= rest;
      if (bot.health <= 0) {
        bot.health = 0;
        bot.alive = false;
        bot.state = 'dead';
        bot.fall = 0;
        bot.channel = null;
        return true;
      }
      // Being shot reveals the shooter's direction: turn and investigate.
      if (attacker && attacker.position) {
        bot.lastKnown = { x: attacker.position.x, z: attacker.position.z };
        if (bot.state === 'hold' || bot.state === 'move') bot.state = 'investigate';
      }
      return false;
    };
    combat.register(bot);
    bots.push(bot);
    return bot;
  }

  // Attackers: entry rushes A, the carrier takes the bomb to B, support trails
  // the carrier, mid holds the middle. Defenders: two anchors, one mid, two
  // rotators who answer the site under attack.
  makeBot('A', 0, 'entry', 'atkA');
  makeBot('A', 1, 'carrier', 'atkB');
  makeBot('A', 2, 'support', 'atkB');
  makeBot('A', 3, 'mid', 'atkMid');
  makeBot('B', 0, 'anchor', 'defA');
  makeBot('B', 1, 'anchor', 'defB');
  makeBot('B', 2, 'mid', 'defMid');
  makeBot('B', 3, 'rotator', 'defMid');
  makeBot('B', 4, 'rotator', 'defB');

  function reset(spawns) {
    for (const bot of bots) {
      const slot = bot.team === 'A' ? bot.slot + 1 : bot.slot;
      const [x, z] = spawns[bot.team][slot];
      bot.position.set(x, 0, z);
      bot.yaw = bot.team === 'A' ? 0 : Math.PI;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.health = 100;
      bot.alive = true;
      bot.state = 'buy';
      bot.route = [];
      bot.waypoint = 0;
      bot.target = null;
      bot.lastKnown = null;
      bot.fall = 0;
      bot.hasBomb = false;
      bot.channel = null;
      bot.holdPoint = null;
      bot.nav = null;
    }
  }

  function buyAll(economy) {
    for (const bot of bots) {
      bot.money = economy.botMoney(bot);
      // Simple policy: rifle when affordable with $300 kept, else SMG, plus
      // armour when rich and a smoke for the carrier.
      if (bot.money >= 3000) { economy.buyFor(bot, 'rifle'); bot.weapon = 'rifle'; }
      else if (bot.money >= 1500) { economy.buyFor(bot, 'smg'); bot.weapon = 'smg'; }
      else bot.weapon = 'pistol';
      // Armour only counts if the purchase clears: the economy is the ledger,
      // the bot's armour value is what combat reads.
      if (bot.money >= 950 && economy.buyFor(bot, 'armor')) bot.armor = 100;
    }
  }

  function hearShot(x, z, team) {
    for (const bot of bots) {
      if (!bot.alive || bot.team === team) continue;
      if (distXZ(bot.position.x, bot.position.z, x, z) > HEAR_RADIUS) continue;
      // Hearing gives a position to check, not a wallhack: the bot walks over
      // and looks, and only shoots what it can see.
      bot.lastKnown = { x, z };
      if (bot.state === 'hold' || bot.state === 'move') bot.state = 'investigate';
    }
  }

  function canSee(bot, enemy, now) {
    const dx = enemy.position.x - bot.position.x;
    const dz = enemy.position.z - bot.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > SEE_RANGE) return false;
    // 100-degree field of view.
    const facing = yawTo(bot.position.x, bot.position.z, enemy.position.x, enemy.position.z);
    if (Math.abs(angleDelta(bot.yaw, facing)) > 0.9) return false;
    const from = scratch.v1.set(bot.position.x, bot.position.y + 1.5, bot.position.z);
    const to = scratch.v2.set(enemy.position.x, enemy.position.y + 1.1, enemy.position.z);
    if (!combat.losClear(from, to)) return false;
    if (combat.smokeBlocks(from, to)) return false;
    return true;
  }

  function moveToward(bot, x, z, dt) {
    const dx = x - bot.position.x;
    const dz = z - bot.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.05) return true;
    const step = Math.min(distance, BOT_SPEED * dt);
    const nx = bot.position.x + (dx / distance) * step;
    const nz = bot.position.z + (dz / distance) * step;
    if (!world.overlaps(nx, bot.position.y, bot.position.z, 0.34, 1.72, 0.04, scratch.box)) bot.position.x = nx;
    if (!world.overlaps(bot.position.x, bot.position.y, nz, 0.34, 1.72, 0.04, scratch.box)) bot.position.z = nz;
    bot.yaw = yawTo(bot.position.x, bot.position.z, x, z);
    return distance < 0.8;
  }

  function followRoute(bot, dt) {
    if (bot.waypoint >= bot.route.length) return true;
    const [x, z] = bot.route[bot.waypoint];
    if (moveToward(bot, x, z, dt)) bot.waypoint += 1;
    return bot.waypoint >= bot.route.length;
  }

  // Directed movement: straight line when the way is clear, otherwise BFS
  // over the nav graph. Straight-line walking alone strands bots on the lane
  // dividers (a defender walking to site A from mid hits the wall and never
  // gets around it), so every duty that picks its own destination — defuse,
  // bomb fetch, investigate, rotate — goes through here.
  const NAV_ADJ = NAV_NODES.map(() => []);
  for (const [a, b] of NAV_EDGES) { NAV_ADJ[a].push(b); NAV_ADJ[b].push(a); }

  function directPathClear(ax, az, bx, bz) {
    const distance = distXZ(ax, az, bx, bz);
    // Sample the way, not the destination: the bot only needs to arrive
    // within 0.8 m, and the destination itself may sit against a wall or a
    // platform edge (the bomb, planted beside one). Sampling the last half
    // metre would call a 1 m hop blocked and send the bot on a BFS detour.
    for (let d = 0.5; d < distance - 0.4; d += 0.5) {
      const t = d / distance;
      if (world.overlaps(ax + (bx - ax) * t, 0, az + (bz - az) * t, 0.34, 1.72, 0.04, scratch.box)) return false;
    }
    return true;
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < NAV_NODES.length; i += 1) {
      const d = distXZ(x, z, NAV_NODES[i][0], NAV_NODES[i][1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // Nearest node with a straight walkable line from (x, z): the nearest node
  // by distance can sit behind a wall, and routing to it strands the bot.
  // Returns -1 when no node is directly reachable (a pocket).
  function nearestReachableNode(x, z) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < NAV_NODES.length; i += 1) {
      const [nx, nz] = NAV_NODES[i];
      const d = distXZ(x, z, nx, nz);
      if (d < bestD && directPathClear(x, z, nx, nz)) { bestD = d; best = i; }
    }
    return best;
  }

  function bfsPath(start, goal) {
    if (start === goal) return [start];
    const prev = new Map([[start, -1]]);
    const queue = [start];
    while (queue.length) {
      const n = queue.shift();
      for (const m of NAV_ADJ[n]) {
        if (prev.has(m)) continue;
        prev.set(m, n);
        if (m === goal) {
          const path = [m];
          let cur = n;
          while (cur !== -1) { path.unshift(cur); cur = prev.get(cur); }
          return path;
        }
        queue.push(m);
      }
    }
    return [start, goal]; // disconnected: best effort straight line
  }

  // Walk toward (x, z) around walls. Returns true on arrival. Replans when
  // the destination moves; skips an intermediate waypoint after 1.5 s without
  // progress, and drops the whole plan after 3 s stuck on the final leg so
  // the next step replans instead of reporting an arrival that never happened.
  function navigate(bot, x, z, dt, now) {
    if (!bot.nav || bot.nav.tx !== x || bot.nav.tz !== z) {
      let path;
      if (directPathClear(bot.position.x, bot.position.z, x, z)) {
        path = [[x, z]];
      } else {
        const start = nearestReachableNode(bot.position.x, bot.position.z);
        const goal = nearestReachableNode(x, z);
        const s = start === -1 ? nearestNode(bot.position.x, bot.position.z) : start;
        const g = goal === -1 ? nearestNode(x, z) : goal;
        path = [...bfsPath(s, g).map((i) => NAV_NODES[i]), [x, z]];
      }
      bot.nav = { path, i: 0, tx: x, tz: z };
      bot.lastX = bot.position.x;
      bot.lastZ = bot.position.z;
      bot.stuckAt = now;
    }
    if (bot.nav.i >= bot.nav.path.length) return true;
    const [wx, wz] = bot.nav.path[bot.nav.i];
    if (moveToward(bot, wx, wz, dt)) bot.nav.i += 1;
    if (distXZ(bot.position.x, bot.position.z, bot.lastX, bot.lastZ) < 0.05) {
      if (bot.nav.i < bot.nav.path.length - 1) {
        if (now - bot.stuckAt > 1.5) { bot.nav.i += 1; bot.stuckAt = now; }
      } else if (now - bot.stuckAt > 3) {
        bot.nav = null;
        return false;
      }
    } else {
      bot.lastX = bot.position.x;
      bot.lastZ = bot.position.z;
      bot.stuckAt = now;
    }
    return bot.nav.i >= bot.nav.path.length;
  }

  function shootAt(bot, enemy, dt, now, onShot) {
    // Face the target, wait out the reaction time, then fire in bursts.
    bot.yaw = yawTo(bot.position.x, bot.position.z, enemy.position.x, enemy.position.z);
    if (now < bot.reactAt) return;
    if (now < bot.nextShotAt) return;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 4 + Math.floor(random() * 3);
      bot.nextShotAt = now + 0.35 + random() * 0.35;
      return;
    }
    const def = WEAPONS[bot.weapon];
    const distance = distXZ(bot.position.x, bot.position.z, enemy.position.x, enemy.position.z);
    // Spread grows with distance and with the target's speed: far or fast
    // targets are hard to hit, close and slow ones are not.
    const targetSpeed = enemy.groundSpeed ? enemy.groundSpeed() : 3;
    const spread = 0.009 + distance * 0.0009 + targetSpeed * 0.004;
    scratch.v1.set(enemy.position.x, enemy.position.y + 1.1, enemy.position.z);
    scratch.v2.set(bot.position.x, bot.position.y + 1.5, bot.position.z);
    scratch.v3.subVectors(scratch.v1, scratch.v2).normalize();
    scratch.v3.x += (random() * 2 - 1) * spread;
    scratch.v3.y += (random() * 2 - 1) * spread;
    scratch.v3.z += (random() * 2 - 1) * spread;
    scratch.v3.normalize();
    combat.fireFlash(scratch.v2);
    const result = combat.shoot(scratch.v2, scratch.v3, def, bot, random);
    bot.burstLeft -= 1;
    bot.nextShotAt = now + def.fireGap + 0.03;
    onShot(bot, result);
  }

  function step(dt, now, ctx) {
    // ctx: { phase, player, bomb, enemiesOf(team), onShot, onKill, onPlantDone, onDefuseDone }
    for (const bot of bots) {
      if (!bot.alive) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        continue;
      }
      bot.group.rotation.y = bot.yaw;
      if (ctx.phase === 'buy' || ctx.phase === 'end' || ctx.phase === 'matchEnd') {
        bot.state = 'buy';
        continue;
      }

      // Perceive: throttled, staggered vision check against every enemy.
      if (now >= bot.perceiveAt) {
        bot.perceiveAt = now + 0.12;
        let nearest = null;
        let nearestDistance = Infinity;
        for (const enemy of ctx.enemiesOf(bot.team)) {
          if (!enemy.alive) continue;
          if (!canSee(bot, enemy, now)) continue;
          const d = distXZ(bot.position.x, bot.position.z, enemy.position.x, enemy.position.z);
          if (d < nearestDistance) { nearest = enemy; nearestDistance = d; }
        }
        if (nearest) {
          if (bot.target !== nearest) bot.reactAt = now + REACT_MIN + random() * (REACT_MAX - REACT_MIN);
          bot.target = nearest;
          bot.lastKnown = { x: nearest.position.x, z: nearest.position.z };
          if (bot.state !== 'engage') bot.state = 'engage';
        } else if (bot.target && !canSee(bot, bot.target, now)) {
          bot.target = null;
          if (bot.state === 'engage') bot.state = bot.lastKnown ? 'investigate' : 'move';
        }
      }

      // Adopt a channel the bomb already holds for this bot (started by the
      // capture setup, or by this bot on an earlier step), and drop a channel
      // the bomb no longer holds: without the adopt, a defuser whose channel
      // exists but whose flag is unset walks off to fight and cancels it.
      if (ctx.bomb.channel && ctx.bomb.channel.actor === bot) bot.channel = ctx.bomb.channel.type;
      else if (bot.channel && (!ctx.bomb.channel || ctx.bomb.channel.actor !== bot)) bot.channel = null;

      // Bomb duties override routes.
      const bomb = ctx.bomb;
      if (bot.team === 'A' && bomb.state === 'dropped' && !bomb.carrier) {
        // Nearest alive attacker fetches the dropped bomb.
        const fetchers = bots.filter((b) => b.team === 'A' && b.alive);
        const nearest = fetchers.reduce((best, b) => {
          const d = distXZ(b.position.x, b.position.z, bomb.position.x, bomb.position.z);
          return !best || d < best.d ? { bot: b, d } : best;
        }, null);
        if (nearest && nearest.bot === bot) {
          // Already there: pick it up. Otherwise walk — never navigate when
          // the bot is already in range, or a detour can carry it away.
          if (distXZ(bot.position.x, bot.position.z, bomb.position.x, bomb.position.z) <= 1.2) bomb.pickup(bot);
          else navigate(bot, bomb.position.x, bomb.position.z, dt, now);
          continue;
        }
      }
      if (bot.hasBomb && bomb.state === 'carried') {
        // The carrier pushes its site and plants.
        if (bot.route.length === 0) { bot.route = ROUTES[bot.routeKey].slice(); bot.waypoint = 0; }
        if (followRoute(bot, dt)) {
          if (bomb.canPlant(bot)) {
            if (bomb.startPlant(bot, ctx.onPlantDone)) bot.channel = 'plant';
          }
        }
        if (bot.channel === 'plant') continue;
      }
      if (bot.team === 'B' && bomb.state === 'planted') {
        // One defender defuses while the rest cover: the nearest alive one.
        const alive = bots.filter((b) => b.team === 'B' && b.alive);
        const nearest = alive.reduce((best, b) => {
          const d = distXZ(b.position.x, b.position.z, bomb.position.x, bomb.position.z);
          return !best || d < best.d ? { bot: b, d } : best;
        }, null);
        if (nearest && nearest.bot === bot) {
          // Already there: start the defuse. Otherwise walk — never navigate
          // when the bot is already in range, or a detour can carry it out
          // of the 1.8 m channel radius and cancel the defuse.
          if (distXZ(bot.position.x, bot.position.z, bomb.position.x, bomb.position.z) <= 1.6) {
            if (bomb.startDefuse(bot, ctx.onDefuseDone)) bot.channel = 'defuse';
          } else {
            navigate(bot, bomb.position.x, bomb.position.z, dt, now);
          }
          if (bot.channel === 'defuse') continue;
        }
      }

      switch (bot.state) {
        case 'engage': {
          if (bot.target && bot.target.alive) {
            shootAt(bot, bot.target, dt, now, ctx.onShot);
          } else {
            bot.state = bot.lastKnown ? 'investigate' : 'move';
          }
          break;
        }
        case 'investigate': {
          if (bot.lastKnown) {
            if (navigate(bot, bot.lastKnown.x, bot.lastKnown.z, dt, now)) {
              bot.lastKnown = null;
              bot.state = 'move';
            }
          } else bot.state = 'move';
          break;
        }
        case 'hold': {
          // Anchors strafe a little and watch their lane; they do not chase.
          bot.yaw += Math.sin(now * 0.5 + bots.indexOf(bot)) * 0.002;
          // A rotator holding the wrong site answers the new attack.
          if (bot.role === 'rotator' && bomb.underAttack) {
            const site = SITES[bomb.underAttack];
            if (distXZ(bot.position.x, bot.position.z, site.center.x, site.center.z) > 6) bot.state = 'move';
          }
          break;
        }
        default: { // 'move', 'buy' (round live), 'rotate'
          // Rotators answer the site under attack by navigating straight to
          // it; everyone else runs their route.
          if (bot.role === 'rotator' && bomb.underAttack) {
            const site = SITES[bomb.underAttack];
            if (navigate(bot, site.center.x, site.center.z, dt, now)) {
              bot.state = 'hold';
              bot.holdPoint = { x: bot.position.x, z: bot.position.z };
            }
            break;
          }
          if (bot.route.length === 0) {
            bot.route = ROUTES[bot.routeKey].slice();
            bot.waypoint = 0;
          }
          if (followRoute(bot, dt)) {
            bot.state = 'hold';
            bot.holdPoint = { x: bot.position.x, z: bot.position.z };
          }
          // Unstick: no progress for 1.5 s skips the waypoint.
          if (distXZ(bot.position.x, bot.position.z, bot.lastX, bot.lastZ) < 0.05) {
            if (now - bot.stuckAt > 1.5) { bot.waypoint += 1; bot.stuckAt = now; }
          } else {
            bot.lastX = bot.position.x;
            bot.lastZ = bot.position.z;
            bot.stuckAt = now;
          }
          break;
        }
      }
    }
  }

  return {
    bots,
    reset,
    buyAll,
    hearShot,
    step,
    aliveOf(team) { return bots.filter((b) => b.team === team && b.alive); },
    byId(id) { return bots.find((b) => b.id === id); },
  };
}
