// Shared helpers: a seeded RNG for deterministic play and capture, small math, and
// the scratch objects the hot loops reuse so the sim allocates nothing per frame
// (criterion 5: no new objects made every frame in hot loops).
import * as THREE from 'three';

// mulberry32: deterministic, seedable, good enough for spread, bot aim and routes.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
export const lerp = (a, b, t) => a + (b - a) * t;

// Scratch vectors and boxes, allocated once and reused by player.js, bots.js and
// combat.js. Never hold a reference to one across a call that reuses it.
export const scratch = {
  v1: new THREE.Vector3(),
  v2: new THREE.Vector3(),
  v3: new THREE.Vector3(),
  v4: new THREE.Vector3(),
  box: new THREE.Box3(),
  ray: new THREE.Raycaster(),
};

// Horizontal distance between two points (y ignored): the measure for ranges,
// hearing and waypoint arrival.
export function distXZ(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

// Yaw (radians, YXZ order) that faces point B from point A on the ground plane.
export function yawTo(ax, az, bx, bz) {
  return Math.atan2(-(bx - ax), -(bz - az));
}

// Shortest signed turn from angle `from` toward angle `to`, in (-PI, PI].
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
