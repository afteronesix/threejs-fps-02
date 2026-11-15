// The map: SANDLINE depot, an original 52 x 40 m yard. Attackers spawn south,
// defenders north; two bombsites (A west, B east) and three lanes between them:
// west lane (long sightline), mid (crates and an arch) and east lane (corners).
// Every box is a collider for actors and a surface a bullet stops on. Static
// meshes never move, so their matrices are baked once (matrixAutoUpdate false).
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Bombsites: plant zones the bomb logic (bomb.js) and the bots read.
export const SITES = {
  A: { id: 'A', name: 'SITE A — WAREHOUSE', center: { x: -18, z: -12 }, half: 4.2 },
  B: { id: 'B', name: 'SITE B — SILOS', center: { x: 18, z: -12 }, half: 4.2 },
};

export const SPAWNS = {
  // Attackers (VANGUARD) south, defenders (EMBER) north; 5 slots each.
  A: [[-3, 16], [-1, 17], [1, 17], [3, 16], [0, 18]],
  B: [[-3, -16], [-1, -17], [1, -17], [3, -16], [0, -18]],
};

// Waypoint routes, read by the bot AI (bots.js). Each route is a list of [x, z]
// the bot walks in order; routes end at a hold position or a bombsite.
export const ROUTES = {
  atkA: [[0, 14], [-8, 10], [-16, 4], [-19, -5], [-18, -12]],
  atkB: [[0, 14], [8, 10], [16, 4], [19, -5], [18, -12]],
  atkMid: [[0, 14], [-2, 8], [0, 2], [2, -6], [0, -10]],
  defA: [[-2, -15], [-10, -14], [-16, -12], [-18, -10]],
  defB: [[2, -15], [10, -14], [16, -12], [18, -10]],
  defMid: [[0, -15], [0, -9], [-2, -3]],
};

// Navigation graph for directed bot movement (defuse, bomb fetch, investigate,
// rotate): nodes in open ground, edges that never cross a wall. The lanes
// connect only through the mid gap (z -8..-3 at x = +/-11); the north
// corridor behind the sites is cut by the lane dividers, so no edge crosses
// it. bots.js runs BFS over this graph and walks node to node.
export const NAV_NODES = [
  [0, 16], [0, -16], [0, 8], [0, -2], [0, -8],
  [-16, 8], [16, 8], [-16, -5], [16, -5],
  [-18, -12], [18, -12], [-16, -16], [16, -16],
];
export const NAV_EDGES = [
  [0, 2], [0, 5], [0, 6], [1, 4], [2, 3], [3, 4], [3, 7], [3, 8],
  [4, 7], [4, 8], [5, 7], [6, 8], [7, 9], [7, 11], [8, 10], [8, 12],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of ['canvas', 'surface', 'hairline', 'ink', 'muted', 'accent']) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  // Site pads read at a glance: amber for A, ember for B.
  // Site pads read as zones, not floodlights: muted amber and ember.
  materials.siteA = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8f6f2f), roughness: 0.7 });
  materials.siteB = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8f4a2f), roughness: 0.7 });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function cylinder(r, h, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), materials[material]);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    // Cylinders collide as their bounding box: close enough at this radius, and
    // the same AABB test as everything else.
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter: 52 x 40 m, walls 4.6 m, open sky.
  box(52.4, 0.4, 40.4, 0, -0.2, 0, 'canvas');
  box(0.4, 4.6, 40.4, -26.2, 2.3, 0, 'surface');
  box(0.4, 4.6, 40.4, 26.2, 2.3, 0, 'surface');
  box(52.4, 4.6, 0.4, 0, 2.3, -20.2, 'surface');
  box(52.4, 4.6, 0.4, 0, 2.3, 20.2, 'surface');

  // Site pads (flat, no collision: actors walk over them).
  box(8.4, 0.06, 8.4, SITES.A.center.x, 0.03, SITES.A.center.z, 'siteA', false);
  box(8.4, 0.06, 8.4, SITES.B.center.x, 0.03, SITES.B.center.z, 'siteB', false);

  // Lane dividers with gaps at the corners: three lanes, each with its own
  // sightlines, connected at mid and behind the sites.
  box(0.5, 3.4, 14, -11, 1.7, 4, 'surface');
  box(0.5, 3.4, 14, 11, 1.7, 4, 'surface');
  box(0.5, 3.4, 10, -11, 1.7, -13, 'surface');
  box(0.5, 3.4, 10, 11, 1.7, -13, 'surface');

  // Mid arch: two pillars and a lintel, a 2.4 m gap to push through.
  box(1.2, 3.4, 1.2, -2.2, 1.7, 0, 'hairline');
  box(1.2, 3.4, 1.2, 2.2, 1.7, 0, 'hairline');
  box(5.6, 0.9, 1.2, 0, 3.85, 0, 'hairline');

  // Cover: 1.1 m crates to crouch behind, 2.2 m containers for full cover.
  const crates = [
    [-20, -1.2, 1.2], [-16, 6, 1.1], [-22, 8, 2.2], [-14, -8, 1.1],
    [20, -1.2, 1.2], [16, 6, 1.1], [22, 8, 2.2], [14, -8, 1.1],
    [-4, 8, 1.1], [4, -4, 1.1], [-5, -6, 2.2], [6, 6, 2.2],
    [-18, -6, 1.1], [18, -6, 1.1], [-22, -14, 2.2], [22, -14, 2.2],
  ];
  for (const [x, z, h] of crates) box(1.6, h, 1.6, x, h / 2, z, 'hairline');
  // Long crates on the lanes.
  box(3.6, 1.1, 1.2, -20, 0.55, 4, 'hairline');
  box(3.6, 1.1, 1.2, 20, 0.55, 4, 'hairline');
  box(1.2, 1.1, 3.6, -6, 0.55, -12, 'hairline');
  box(1.2, 1.1, 3.6, 6, 0.55, -12, 'hairline');

  // Site A: warehouse platform (jumpable, 0.5 m) and stacked containers.
  box(6, 0.5, 3, -21, 0.25, -12, 'surface');
  box(2.4, 2.2, 2.4, -15, 1.1, -15, 'hairline');
  box(2.4, 2.2, 2.4, -21, 1.1, -8, 'hairline');
  // Site B: two silos and a container wall.
  cylinder(1.6, 4.4, 15, -15, 'surface');
  cylinder(1.6, 4.4, 21, -9, 'surface');
  box(4.8, 2.2, 1.2, 18, 1.1, -16.5, 'hairline');

  // Spawn cover so neither team spawns in the open.
  box(3, 1.6, 1, -6, 0.8, 15, 'hairline');
  box(3, 1.6, 1, 6, 0.8, 15, 'hairline');
  box(3, 1.6, 1, -6, 0.8, -15, 'hairline');
  box(3, 1.6, 1, 6, 0.8, -15, 'hairline');

  // Light: late-afternoon desert sun, warm key + cool sky fill, soft fog.
  const sky = new THREE.HemisphereLight(new THREE.Color(0xbfd4e6), new THREE.Color(PALETTE.canvas), 1.4);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(0xffe3b3), 2.4);
  key.position.set(14, 20, 12);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.7);
  fill.position.set(-12, 10, 14);
  scene.add(fill);

  return {
    colliders,
    shootables,
    group,
    // Shared AABB test: does a box of half-width r and height h at (x, y, z)
    // overlap any collider? player.js and bots.js both use it. `lift` keeps the
    // feet and crown out of horizontal tests so standing on the floor is not
    // read as walking into a wall.
    overlaps(x, y, z, r, h, lift, probe) {
      probe.min.set(x - r, y + lift, z - r);
      probe.max.set(x + r, y + h - lift, z + r);
      for (const c of colliders) if (probe.intersectsBox(c)) return c;
      return null;
    },
  };
}
