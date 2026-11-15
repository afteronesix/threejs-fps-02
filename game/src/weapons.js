// Weapons: the table every system reads (economy prices, combat damage, the
// bots' buying). Three guns, two grenades. Each gun is a view model, a
// magazine, a reload, and a spread model: a still base, a movement penalty and
// a bloom that grows with sustained fire and recovers when the trigger lifts,
// so stopping to aim and tapping pays and spraying on the move does not.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// damage: torso damage at close range; headshots multiply by 4 (combat.js).
// spread: radians of random cone at standstill; move adds up to moveSpread.
// recoil: pitch kick per shot in radians; bloom: spread added per shot.
export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 SIDEARM', price: 0, damage: 34, headMult: 4, mag: 12, reserve: 48, fireGap: 0.18, reloadTime: 1.4, spread: 0.0035, moveSpread: 0.02, recoil: 0.011, bloom: 0.0016, auto: false },
  rifle: { id: 'rifle', name: 'VK-47 RIFLE', price: 2700, damage: 34, headMult: 4, mag: 30, reserve: 90, fireGap: 0.1, reloadTime: 2.2, spread: 0.0022, moveSpread: 0.028, recoil: 0.009, bloom: 0.0012, auto: true },
  smg: { id: 'smg', name: 'K9 SMG', price: 1200, damage: 26, headMult: 4, mag: 32, reserve: 96, fireGap: 0.07, reloadTime: 1.8, spread: 0.005, moveSpread: 0.02, recoil: 0.006, bloom: 0.001, auto: true },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'FRAG GRENADE', price: 300, radius: 6.5, maxDamage: 120, fuse: 1.1 },
  smoke: { id: 'smoke', name: 'SMOKE GRENADE', price: 300, radius: 3.4, duration: 12 },
};

const ARMOR_PRICE = 650;

export function createArsenal(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  // One view model per gun, built from boxes; only the equipped one shows.
  function buildGun(def) {
    const model = new THREE.Group();
    const long = def.id === 'rifle' ? 0.52 : def.id === 'smg' ? 0.4 : 0.24;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, long), metal);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.32), grip);
    barrel.position.set(0, 0.03, -long / 2 - 0.12);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.2), grip);
    stock.position.set(0, -0.02, long / 2 + 0.08);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accent);
    sight.position.set(0, 0.075, -long / 4);
    model.add(receiver, barrel, stock, sight);
    if (def.id === 'pistol') {
      const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.08), grip);
      gripMesh.position.set(0, -0.1, 0.08);
      gripMesh.rotation.x = 0.3;
      model.add(gripMesh);
    }
    model.position.set(0.25, -0.24, -0.7);
    model.scale.setScalar(0.6); // view models sit close to the camera: small
    model.visible = false;
    camera.add(model);
    return model;
  }

  const models = {};
  for (const def of Object.values(WEAPONS)) models[def.id] = buildGun(def);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.25, -0.22, -1.05);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.25, -0.2, -0.85);
  camera.add(flashLight);

  // Loadout: what the player owns. Bots carry the same shape (bots.js).
  const state = {
    equipped: 'pistol',
    owned: { pistol: true, rifle: false, smg: false },
    mags: { pistol: 12, rifle: 30, smg: 32 },
    reserves: { pistol: 48, rifle: 90, smg: 96 },
    grenades: { frag: 0, smoke: 0 },
    armor: false,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    switchLeft: 0,
  };
  models.pistol.visible = true;

  function def() { return WEAPONS[state.equipped]; }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.switchLeft = Math.max(0, state.switchLeft - dt);
    // Bloom recovers when the trigger lifts; kick eases back every frame.
    state.bloom = Math.max(0, state.bloom - dt * 0.02);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.equipped];
    model.position.z = -0.7 + state.kick;
    model.rotation.x = state.kick * 2.2;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const d = def();
      model.rotation.x = -0.55 * Math.min(1, (d.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = d.mag - state.mags[state.equipped];
        const take = Math.min(need, state.reserves[state.equipped]);
        state.mags[state.equipped] += take;
        state.reserves[state.equipped] -= take;
      }
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
  }

  return {
    state,
    step,
    def,
    ready() {
      return state.mags[state.equipped] > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switchLeft === 0;
    },
    pullTrigger() {
      const d = def();
      state.cooldown = d.fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(0.02, state.bloom + d.bloom);
    },
    takeRound() {
      if (state.mags[state.equipped] <= 0) return false;
      state.mags[state.equipped] -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || state.mags[state.equipped] === d.mag || state.reserves[state.equipped] === 0) return false;
      state.reloadLeft = d.reloadTime;
      return true;
    },
    // Spread in radians: still base + movement penalty + accumulated bloom.
    // Crouching halves the movement penalty.
    spread(speed, crouching) {
      const d = def();
      const move = Math.min(1, speed / 5.2) * d.moveSpread * (crouching ? 0.5 : 1);
      return d.spread + move + state.bloom;
    },
    switchTo(id) {
      if (!WEAPONS[id] || !state.owned[id] || id === state.equipped) return false;
      models[state.equipped].visible = false;
      state.equipped = id;
      models[id].visible = true;
      state.switchLeft = 0.35;
      state.reloadLeft = 0;
      return true;
    },
    buy(id) {
      if (WEAPONS[id]) {
        if (state.owned[id]) return false;
        state.owned[id] = true;
        state.mags[id] = WEAPONS[id].mag;
        state.reserves[id] = WEAPONS[id].reserve;
        return true;
      }
      if (GRENADES[id]) {
        if (state.grenades[id] >= 2) return false;
        state.grenades[id] += 1;
        return true;
      }
      if (id === 'armor') {
        if (state.armor) return false;
        state.armor = true;
        return true;
      }
      return false;
    },
    throwGrenade(id) {
      if (state.grenades[id] <= 0) return false;
      state.grenades[id] -= 1;
      return true;
    },
    refill() {
      state.mags = { pistol: 12, rifle: 30, smg: 32 };
      state.reserves = { pistol: 48, rifle: 90, smg: 96 };
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      state.switchLeft = 0;
    },
  };
}

export { ARMOR_PRICE };
