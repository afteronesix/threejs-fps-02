// Combat: the one place a shot is resolved. A ray from the muzzle is tested
// against the map and every actor's hitboxes at once; the NEAREST hit wins, so
// a bullet never passes through a wall or through one body into another. Damage
// falls off with distance and multiplies by hit part (head x4, torso x1, legs
// x0.75); armour is applied by the actor hit. Grenades, tracers and muzzle
// flashes live here too, all pooled: nothing is allocated per shot.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { clamp } from './util.js';
import { GRENADES } from './weapons.js';

const PART_MULT = { head: 4, torso: 1, legs: 0.75 };
const TRACER_POOL = 20;
const FLASH_POOL = 6;

export function createCombat(scene, world) {
  const actors = []; // {id, name, team, alive, hitMeshes, chest(), damage(amount, attacker)}
  const grenades = [];
  const smokes = [];
  const explosions = [];
  const raycaster = new THREE.Raycaster();
  raycaster.far = 140;
  // Private scratch: callers pass shared scratch vectors as `from`/`dir`, so
  // this module must never reuse scratch.v1-v4 internally — a copy into a
  // shared vector would overwrite the caller's argument.
  const dirV = new THREE.Vector3();
  const endV = new THREE.Vector3();
  const segV = new THREE.Vector3();
  const segV2 = new THREE.Vector3();

  // Tracer pool: thin lines from muzzle to hit point, fading in 70 ms.
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  // Muzzle flash pool for bots (the player's flash is on the view model).
  const flashes = [];
  const flashGeometry = new THREE.PlaneGeometry(0.3, 0.3);
  const flashMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < FLASH_POOL; i += 1) {
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.visible = false;
    scene.add(flash);
    flashes.push({ flash, life: 0 });
  }
  let flashIndex = 0;

  // Explosion pool: an expanding shell + light, gone in half a second.
  for (let i = 0; i < 2; i += 1) {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }),
    );
    shell.visible = false;
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 14);
    scene.add(shell, light);
    explosions.push({ shell, light, life: 0 });
  }

  function fireTracer(from, to) {
    const t = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_POOL;
    const positions = t.line.geometry.attributes.position;
    positions.setXYZ(0, from.x, from.y, from.z);
    positions.setXYZ(1, to.x, to.y, to.z);
    positions.needsUpdate = true;
    t.line.material.opacity = 0.85;
    t.line.visible = true;
    t.life = 0.07;
  }

  function fireFlash(point) {
    const f = flashes[flashIndex];
    flashIndex = (flashIndex + 1) % FLASH_POOL;
    f.flash.position.copy(point);
    f.flash.visible = true;
    f.life = 0.06;
  }

  // Damage falloff: full to 15 m, linear down to 60% at 40 m and beyond.
  function falloff(distance) {
    if (distance <= 15) return 1;
    if (distance >= 40) return 0.6;
    return 1 - (distance - 15) * (0.4 / 25);
  }

  // Is the straight line from a to b clear of the map? Bots use it for vision.
  function losClear(a, b) {
    segV.subVectors(b, a);
    const distance = segV.length();
    if (distance < 0.01) return true;
    segV.normalize();
    raycaster.set(a, segV);
    raycaster.far = distance;
    return raycaster.intersectObjects(world.shootables, false).length === 0;
  }

  // Does the segment a-b pass through any live smoke volume? Smoke blocks
  // bot vision (and the player's view, being opaque geometry).
  function smokeBlocks(a, b) {
    for (const s of smokes) {
      // Closest approach of the segment to the smoke centre, squared.
      segV.subVectors(b, a);
      segV2.subVectors(s.center, a);
      const t = clamp(segV2.dot(segV) / Math.max(0.001, segV.lengthSq()), 0, 1);
      endV.copy(a).addScaledVector(segV, t);
      if (endV.distanceToSquared(s.center) < s.radius * s.radius) return true;
    }
    return false;
  }

  function register(actor) {
    actors.push(actor);
    // The raycast resolves hits through userData.actor; set it here so every
    // registered actor — bots and the player — resolves the same way.
    for (const mesh of actor.hitMeshes) mesh.userData.actor = actor;
  }

  // Resolve one shot. `from` is the muzzle, `dir` the aim direction (already
  // spread by the caller), `def` the weapon table row. Returns the outcome so
  // the caller can drive hitmarkers, kill feed and economy.
  function shoot(from, dir, def, shooter, random) {
    dirV.copy(dir).normalize();
    raycaster.set(from, dirV);
    raycaster.far = 140;
    const targets = world.shootables;
    const hitMeshes = [];
    for (const actor of actors) {
      // No friendly fire: a shot only ever tests the other team's bodies.
      if (actor.alive && actor !== shooter && actor.team !== shooter.team) hitMeshes.push(...actor.hitMeshes);
    }
    const hits = raycaster.intersectObjects(targets.concat(hitMeshes), false);
    const end = endV.copy(from).addScaledVector(dirV, 140);
    if (hits.length === 0) {
      fireTracer(from, end);
      return { hit: null };
    }
    const hit = hits[0];
    fireTracer(from, hit.point);
    const actor = hit.object.userData.actor;
    if (!actor || !actor.alive) return { hit: 'world', point: hit.point };
    const part = hit.object.userData.part || 'torso';
    const damage = Math.round(def.damage * PART_MULT[part] * falloff(hit.distance));
    const killed = actor.damage(damage, shooter);
    return { hit: 'actor', actor, part, damage, killed, point: hit.point, headshot: part === 'head' };
  }

  function throwGrenade(from, dir, type, owner, onExplode) {
    const def = GRENADES[type];
    grenades.push({
      type, owner, onExplode,
      position: from.clone(),
      velocity: new THREE.Vector3(dir.x * 13, dir.y * 13 + 3.5, dir.z * 13),
      fuse: def.fuse,
      mesh: new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(type === 'frag' ? PALETTE.teamB : PALETTE.muted) }),
      ),
    });
    const g = grenades[grenades.length - 1];
    g.mesh.position.copy(g.position);
    scene.add(g.mesh);
  }

  function explode(position, owner) {
    const def = GRENADES.frag;
    const boom = explosions.find((e) => e.life <= 0) || explosions[0];
    boom.shell.position.copy(position);
    boom.light.position.copy(position);
    boom.shell.visible = true;
    boom.life = 0.5;
    boom.maxLife = 0.5;
    boom.power = 60;
    boom.light.intensity = 60;
    const events = [];
    for (const actor of actors) {
      if (!actor.alive || actor === owner || actor.team === owner.team) continue;
      const chest = actor.chest();
      const distance = chest.distanceTo(position);
      if (distance > def.radius) continue;
      // No damage through walls: the blast must see the actor.
      if (!losClear(position, chest)) continue;
      const damage = Math.round(def.maxDamage * (1 - (distance / def.radius) * 0.7));
      const killed = actor.damage(damage, owner);
      events.push({ actor, damage, killed });
    }
    return events;
  }

  function deploySmoke(position) {
    const def = GRENADES.smoke;
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x9a938a), transparent: true, opacity: 0.55, roughness: 1, depthWrite: false });
    for (let i = 0; i < 5; i += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1.4 + (i % 3) * 0.4, 10, 8), material);
      puff.position.set((i - 2) * 0.9, 0.8 + (i % 2) * 0.9, (i % 2 ? 0.8 : -0.8));
      group.add(puff);
    }
    group.position.copy(position);
    scene.add(group);
    smokes.push({ center: position.clone(), radius: def.radius, until: performance.now() / 1000 + def.duration, group });
  }

  function step(dt, now) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
      if (t.life <= 0) t.line.visible = false;
    }
    for (const f of flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) f.flash.visible = false;
    }
    for (const e of explosions) {
      if (e.life <= 0) continue;
      e.life -= dt;
      const k = 1 - Math.max(0, e.life) / (e.maxLife || 0.5);
      e.shell.scale.setScalar(1 + k * 5);
      e.shell.material.opacity = Math.max(0, 0.7 * (1 - k));
      e.light.intensity = (e.power || 60) * (1 - k);
      if (e.life <= 0) { e.shell.visible = false; e.light.intensity = 0; }
    }
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.velocity.y -= 20 * dt;
      g.position.addScaledVector(g.velocity, dt);
      if (g.position.y < 0.09) {
        g.position.y = 0.09;
        g.velocity.y *= -0.35;
        g.velocity.x *= 0.6;
        g.velocity.z *= 0.6;
      }
      g.mesh.position.copy(g.position);
      g.fuse -= dt;
      if (g.fuse <= 0) {
        scene.remove(g.mesh);
        g.mesh.geometry.dispose();
        g.mesh.material.dispose();
        grenades.splice(i, 1);
        if (g.type === 'frag') g.onExplode?.(explode(g.position, g.owner));
        else deploySmoke(g.position);
      }
    }
    for (let i = smokes.length - 1; i >= 0; i -= 1) {
      if (now < smokes[i].until) continue;
      scene.remove(smokes[i].group);
      smokes.splice(i, 1);
    }
  }

  // The bomb's detonation: the same explosion visual at full scale, no damage
  // (the round is over by then). Called by main.js on the bomb's timer.
  function detonate(position) {
    const boom = explosions.find((e) => e.life <= 0) || explosions[0];
    boom.shell.position.copy(position);
    boom.light.position.copy(position);
    boom.shell.visible = true;
    boom.life = 0.8;
    boom.maxLife = 0.8;
    boom.power = 120;
    boom.light.intensity = 120;
  }

  return { register, shoot, throwGrenade, losClear, smokeBlocks, fireFlash, detonate, step, actors };
}
