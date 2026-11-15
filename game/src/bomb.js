// The bomb: the objective beyond killing. One actor carries it; if the
// carrier dies it drops and anyone on the attacking team can pick it up by
// walking over it. Planting takes 3 s standing in a site (hold E), defusing
// 5 s at the planted bomb; either channel breaks if the actor dies or leaves.
// A planted bomb ticks for 35 s, beeping faster as it runs out, then
// detonates. The round logic (rounds.js) reads this state to decide the
// winner; the bots read it to choose their duties.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { SITES } from './world.js';

const PLANT_TIME = 3;
const DEFUSE_TIME = 5;
const BOMB_TIMER = 35;

export function createBomb(scene) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.4 }),
  );
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
  );
  light.position.set(0, 0.14, 0);
  const glow = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 4);
  glow.position.y = 0.3;
  group.add(body, light, glow);
  group.visible = false;
  scene.add(group);

  const state = {
    state: 'carried', // carried | dropped | planted | defused | exploded
    carrier: null,
    site: null,
    position: new THREE.Vector3(),
    timerLeft: BOMB_TIMER,
    channel: null, // { type: 'plant'|'defuse', actor, progress, onDone }
    underAttack: null,
    beepAt: 0,
  };

  function siteAt(x, z) {
    for (const site of Object.values(SITES)) {
      if (Math.abs(x - site.center.x) <= site.half && Math.abs(z - site.center.z) <= site.half) return site.id;
    }
    return null;
  }

  function syncVisual() {
    if (state.state === 'dropped' || state.state === 'planted') {
      if (group.parent !== scene) scene.add(group);
      group.visible = true;
      group.position.set(state.position.x, 0.12, state.position.z);
    } else if (state.state === 'carried' && state.carrier && state.carrier.group) {
      // Ride on the carrier bot's back; the player carries it in the HUD.
      state.carrier.group.add(group);
      group.visible = true;
      group.position.set(0, 1.35, 0.25);
    } else {
      group.visible = false;
    }
  }

  return {
    get state() { return state.state; },
    get carrier() { return state.carrier; },
    get site() { return state.site; },
    get position() { return state.position; },
    get timerLeft() { return state.timerLeft; },
    get channel() { return state.channel; },
    get underAttack() { return state.underAttack; },
    set underAttack(v) { state.underAttack = v; },

    reset(carrier) {
      state.state = 'carried';
      state.carrier = carrier;
      state.site = null;
      state.timerLeft = BOMB_TIMER;
      state.channel = null;
      state.underAttack = null;
      if (carrier) carrier.hasBomb = true;
      syncVisual();
    },

    drop() {
      if (state.state !== 'carried' || !state.carrier) return;
      state.carrier.hasBomb = false;
      state.position.set(state.carrier.position.x, 0, state.carrier.position.z);
      state.carrier = null;
      state.state = 'dropped';
      state.channel = null;
      syncVisual();
    },

    pickup(actor) {
      if (state.state !== 'dropped') return false;
      // The bomb is picked up by walking over it, never from across the map.
      if (Math.hypot(actor.position.x - state.position.x, actor.position.z - state.position.z) > 1.5) return false;
      state.state = 'carried';
      state.carrier = actor;
      actor.hasBomb = true;
      syncVisual();
      return true;
    },

    canPlant(actor) {
      return state.state === 'carried' && state.carrier === actor && siteAt(actor.position.x, actor.position.z) !== null;
    },

    startPlant(actor, onDone) {
      if (!this.canPlant(actor) || state.channel) return false;
      state.channel = { type: 'plant', actor, progress: 0, onDone, site: siteAt(actor.position.x, actor.position.z) };
      return true;
    },

    startDefuse(actor, onDone) {
      if (state.state !== 'planted' || state.channel) return false;
      const d = Math.hypot(actor.position.x - state.position.x, actor.position.z - state.position.z);
      if (d > 1.8) return false;
      state.channel = { type: 'defuse', actor, progress: 0, onDone };
      return true;
    },

    cancelChannel(actor) {
      if (state.channel && state.channel.actor === actor) state.channel = null;
    },

    // Advance the channel and the bomb timer. Callbacks fire exactly once.
    step(dt, now, hooks) {
      const ch = state.channel;
      if (ch) {
        const actor = ch.actor;
        let ok = actor.alive;
        if (ok && ch.type === 'plant') ok = siteAt(actor.position.x, actor.position.z) === ch.site;
        if (ok && ch.type === 'defuse') {
          ok = Math.hypot(actor.position.x - state.position.x, actor.position.z - state.position.z) <= 1.8;
        }
        if (!ok) {
          state.channel = null;
        } else {
          ch.progress += dt / (ch.type === 'plant' ? PLANT_TIME : DEFUSE_TIME);
          if (ch.progress >= 1) {
            state.channel = null;
            if (ch.type === 'plant') {
              state.state = 'planted';
              state.site = ch.site;
              state.position.set(actor.position.x, 0, actor.position.z);
              if (state.carrier) state.carrier.hasBomb = false;
              state.carrier = null;
              state.timerLeft = BOMB_TIMER;
              state.beepAt = now;
              syncVisual();
              hooks.onPlanted?.(ch.site, actor);
              ch.onDone?.();
            } else {
              state.state = 'defused';
              syncVisual();
              hooks.onDefused?.(actor);
              ch.onDone?.();
            }
          }
        }
      }
      if (state.state === 'planted') {
        state.timerLeft -= dt;
        // Beeping accelerates: every 1 s early, every 0.25 s in the last 5 s.
        const interval = state.timerLeft > 10 ? 1 : state.timerLeft > 5 ? 0.5 : 0.25;
        if (now >= state.beepAt) {
          state.beepAt = now + interval;
          glow.intensity = 6;
          hooks.onBeep?.();
        } else {
          glow.intensity = Math.max(0, glow.intensity - dt * 20);
        }
        if (state.timerLeft <= 0) {
          state.state = 'exploded';
          syncVisual();
          hooks.onExploded?.(state.site);
        }
      }
    },
  };
}
