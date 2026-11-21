import * as THREE from 'three';

// ---------- Tunables ----------
const RENDER_HEIGHT = 300;        // internal resolution; stretched with no smoothing
const SKY = 0xe8e6df;
const INK = 0x1c1c1c;
const ACCENT = 0xd02818;
// Off-white and faded pastels, one per island.
const PALETTE = [0xffffff, 0xd9d4c7, 0xb8c6da, 0xe8bfa8, 0xc9dbb8, 0xd8c8e4, 0xf0dfa4,
                 0xaed3d4, 0xe4b4bc, 0xc2c2c2, 0xdde6c0, 0xf2cfa6, 0xbcd0ea, 0xefe9da];

// Movement
const WALK = 12, SPRINT = 24, CROUCH_SPEED = 5;
const GRAVITY = 30, JUMP = 12.5;
const WALL_JUMP_UP = 12.5, WALL_JUMP_OUT = 11, WALL_SLIDE_MAX_FALL = 5;
const STAND_H = 1.8, CROUCH_H = 0.9, PLAYER_R = 0.45;
const SLIDE_MIN_SPEED = 17, SLIDE_TIME = 1.0, SLIDE_BOOST = 1.25, SLIDE_FRICTION = 7;

// Signboards (live websites)
const SIGN_W = 16, SIGN_H = 12, SIGN_PX = 800;   // world size, and iframe width in CSS pixels
const SIGN_LOAD_DIST = 50;    // the nearest sign within this range loads its site
const SIGN_USE_DIST = 26;     // how close you must be to browse it
const ARRIVE_DIST = 14;
const ISLAND_DEPTH = 16;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $('view'), destEl = $('dest'), hintEl = $('hint'), leaveBtn = $('leave');
const qInput = $('q'), startEl = $('start');
const pageEl = $('page'), pageTitle = $('page-title'), pageBody = $('page-body'), pageStatus = $('page-status');

// ---------- Renderers ----------
// WebGL draws the world at low resolution. Live websites are real iframes placed
// in 3D with a CSS matrix, in a layer *behind* the canvas; each active signboard
// punches a transparent hole in the canvas so the page shows through.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(1);
renderer.autoClear = false;
renderer.setClearColor(SKY, 1);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY, 90, 600);
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 3000);
camera.rotation.order = 'YXZ';

const sitesEl = document.createElement('div');
sitesEl.id = 'sites';
document.body.prepend(sitesEl);

// The hand and compass live in their own scene, drawn on top of the world.
const handScene = new THREE.Scene();
const handCam = new THREE.PerspectiveCamera(50, 1, 0.01, 20);

function resize() {
  const w = Math.round(RENDER_HEIGHT * innerWidth / innerHeight);
  renderer.setSize(w, RENDER_HEIGHT, false);
  camera.aspect = handCam.aspect = w / RENDER_HEIGHT;
  camera.updateProjectionMatrix();
  handCam.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// PS1-style vertex snapping: vertices jump between coarse screen positions.
function retro(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       gl_Position.xy = floor(gl_Position.xy / gl_Position.w * vec2(320.0, 240.0) + 0.5)
                        / vec2(320.0, 240.0) * gl_Position.w;`
    );
  };
  return material;
}

function pixelTexture(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;   // less shimmer far away, still pixel-sharp
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
function rng(seedStr) {   // small seeded generator, so the world is the same every load
  let s = Math.floor(hash(seedStr) * 4294967296) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Sky ----------
scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
sunLight.position.set(-0.4, 1, 0.6);
scene.add(sunLight);

// The abyss: a black floor far below the islands, with a faint grid for depth.
const ABYSS_Y = -90;
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = ABYSS_Y;
  const lines = new THREE.GridHelper(6000, 150, 0x2a2a2a, 0x1a1a1a);
  lines.material.fog = false;
  lines.position.y = ABYSS_Y + 0.5;
  scene.add(floor, lines);
}

const sky = new THREE.Group();   // follows the player so the horizon never gets closer
scene.add(sky);
{
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const grad = x.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#f3c9b0');
  x.fillStyle = grad;
  x.beginPath(); x.arc(32, 32, 31, 0, Math.PI * 2); x.fill();
  x.globalCompositeOperation = 'destination-out';
  for (let y = 34, h = 2; y < 64; y += h + 4, h += 1) x.fillRect(0, y, 64, h);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: pixelTexture(c), fog: false }));
  sun.scale.set(520, 520, 1);
  sun.position.set(0, 260, -1700);
  sky.add(sun);
}

// Black type on a white plate, as a pixelated texture.
function labelTexture(text, color = '#1c1c1c') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 256, 32);
  x.strokeStyle = color;
  x.lineWidth = 2;
  x.strokeRect(1, 1, 254, 30);
  x.font = 'bold 20px "Courier New", monospace';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = color;
  const full = text.toUpperCase();
  let t = full;
  while (x.measureText(t).width > 240 && t.length > 4) t = t.slice(0, -2);
  x.fillText(t === full ? t : t + '…', 128, 17);
  return pixelTexture(c);
}
function makeLabel(text, width = 14, color) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(text, color) }));
  s.scale.set(width, width / 8, 1);
  return s;
}

// ---------- Solid world: islands and blocks ----------
const islands = [];     // { name, x, y, z, r }  (y is the walkable top)
const colliders = [];   // axis-aligned boxes { minX, maxX, minY, maxY, minZ, maxZ }
const inkLine = retro(new THREE.LineBasicMaterial({ color: INK }));
const blockMats = PALETTE.map((color) => retro(new THREE.MeshLambertMaterial({ color, flatShading: true })));
const whiteMat = retro(new THREE.MeshLambertMaterial({ color: 0xfbfaf5, flatShading: true }));

// Tiled floor for island tops, so the ground reads against the pale sky.
const groundMat = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = '#f7f5ee'; x.fillRect(0, 0, 32, 32);
  x.fillStyle = '#dedacd'; x.fillRect(0, 0, 16, 16); x.fillRect(16, 16, 16, 16);
  x.strokeStyle = '#b3afa2'; x.strokeRect(0.5, 0.5, 32, 32);
  const tex = pixelTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  return retro(new THREE.MeshLambertMaterial({ map: tex }));
})();

// Colliders are bucketed into a coarse grid so physics only tests nearby boxes.
const CELL = 16, grid = new Map(), NOTHING = [];
const cellKey = (cx, cz) => (cx + 2048) * 4096 + (cz + 2048);
const nearby = (x, z) => grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || NOTHING;

/** Adds a solid box you can stand on and collide with. (x, z) centre, y0 bottom. */
const blockSpecs = [];
function addBlock(x, y0, z, w, h, d, mat = whiteMat, extra = {}) {
  const lift = (blockSpecs.length % 6) * 0.012;   // visual only; the collider keeps the true height
  blockSpecs.push({ x, y: y0 + (h + lift) / 2, z, w, h: h + lift, d, mat });
  const c = { minX: x - w / 2, maxX: x + w / 2, minY: y0, maxY: y0 + h, minZ: z - d / 2, maxZ: z + d / 2, ...extra };
  colliders.push(c);
  for (let cx = Math.floor((c.minX - 1) / CELL); cx <= Math.floor((c.maxX + 1) / CELL); cx++) {
    for (let cz = Math.floor((c.minZ - 1) / CELL); cz <= Math.floor((c.maxZ + 1) / CELL); cz++) {
      const k = cellKey(cx, cz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(c);
    }
  }
  return c;
}

// Draws every block added so far: one instanced mesh per material, and a
// single set of line segments for all the inked outlines.
function drawBlocks() {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const byMat = new Map();
  for (const b of blockSpecs) byMat.set(b.mat, [...(byMat.get(b.mat) || []), b]);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (const [mat, list] of byMat) {
    const mesh = new THREE.InstancedMesh(unit, mat, list.length);
    list.forEach((b, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h, b.d))));
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  const EDGES = [0,1, 1,3, 3,2, 2,0, 4,5, 5,7, 7,6, 6,4, 0,4, 1,5, 2,6, 3,7];
  const pos = new Float32Array(blockSpecs.length * 72);
  blockSpecs.forEach((b, i) => {
    EDGES.forEach((corner, j) => {
      pos[i * 72 + j * 3] = b.x + (corner & 1 ? 0.5 : -0.5) * b.w;
      pos[i * 72 + j * 3 + 1] = b.y + (corner & 2 ? 0.5 : -0.5) * b.h;
      pos[i * 72 + j * 3 + 2] = b.z + (corner & 4 ? 0.5 : -0.5) * b.d;
    });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, inkLine);
  lines.frustumCulled = false;
  scene.add(lines);
}

function buildIslands(list) {
  list.forEach((isl, k) => {
    islands.push(isl);
    const mat = blockMats[k % blockMats.length];
    const geo = new THREE.CylinderGeometry(isl.r, isl.r * 0.55, ISLAND_DEPTH, 14);
    const body = new THREE.Mesh(geo, [mat, groundMat, mat]);   // pastel sides, tiled top
    body.position.set(isl.x, isl.y - ISLAND_DEPTH / 2, isl.z);
    body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), inkLine));
    scene.add(body);

    // Lookout tower in the middle. A wall stands beside it: wall-jump between
    // the two to reach the top.
    // (It stands off-centre: the middle of the island belongs to the launch shaft.)
    addBlock(isl.x - 16, isl.y, isl.z, 6, 6, 6, mat);
    addBlock(isl.x - 9, isl.y, isl.z, 1.5, 10, 6, mat);
    const name = makeLabel(isl.name, 30);
    name.position.set(isl.x - 16, isl.y + 15, isl.z);
    scene.add(name);
  });
}

// A parkour route between every pair of islands.
//  - Neighbours with nothing between them get a bridge of scattered blocks at
//    ground level. Ground bridges never cross each other.
//  - Every other pair gets a sky bridge that flies straight over whatever is
//    in the way. Each island has a red launch shaft in its middle: step on
//    the pad and it throws you up the shaft and out through a hole in the
//    hub platform high above. Hold any direction to land on the hub; every
//    sky bridge from that island leaves from it. At the far end, walk onto
//    that island's hub and step off the edge to drop in.
// All sky bridges fly at one height, so where two cross they simply join up.
const bridges = [];   // { a, b, sky, blocks } - blocks run from a to b
const hubs = [];      // per island: null, or { x, z, top, size, pad: { x, z, top } }
const SKY_ABOVE_HIGHEST = 32, HOP = 10, HUB_SIZE = 20, SHAFT = 2.5;   // SHAFT: half-width of the launch shaft
const padMat = retro(new THREE.MeshLambertMaterial({ color: ACCENT, flatShading: true }));

function segmentsCross(a, b, c, d) {
  const side = (p, q, r) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

function buildBridges() {
  const n = islands.length;
  const pairs = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    pairs.push({ a, b, len: Math.hypot(islands[b].x - islands[a].x, islands[b].z - islands[a].z) });
  }
  pairs.sort((p, q) => p.len - q.len);   // shortest first, so close neighbours get the ground bridges

  // Decide which pairs can stay on the ground.
  const ground = [];
  for (const { a, b, len } of pairs) {
    const A = islands[a], B = islands[b];
    const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
    const blocked = islands.some((C) => {
      if (C === A || C === B) return false;
      const along = (C.x - A.x) * dx + (C.z - A.z) * dz;
      const off = Math.abs((C.x - A.x) * dz - (C.z - A.z) * dx);
      return along > 0 && along < len && off < C.r + 8;
    });
    const crosses = ground.some((g) => g.a !== a && g.a !== b && g.b !== a && g.b !== b &&
      segmentsCross(A, B, islands[g.a], islands[g.b]));
    const sky = blocked || crosses;
    const bridge = { a, b, len, dx, dz, sky, blocks: [] };
    if (!sky) ground.push(bridge);
    bridges.push(bridge);
  }

  // A hub above every island that has a sky bridge, all at the same height.
  const alt = Math.max(...islands.map((isl) => isl.y)) + SKY_ABOVE_HIGHEST;
  for (let i = 0; i < n; i++) {
    const used = bridges.some((br) => br.sky && (br.a === i || br.b === i));
    hubs.push(used ? { x: islands[i].x, z: islands[i].z, top: alt, size: HUB_SIZE } : null);
  }

  for (const bridge of bridges) {
    const { a, b, len, dx, dz, sky, blocks } = bridge;
    const A = islands[a], B = islands[b];
    const rand = rng(`bridge${a}-${b}`);
    const at = (s, side = 0) => ({ x: A.x + dx * s - dz * side, z: A.z + dz * s + dx * side });
    const mat = (t) => blockMats[(t < 0.5 ? a : b) % blockMats.length];
    if (!sky) {
      const start = A.r + 5, end = len - B.r - 5;
      const steps = Math.max(Math.ceil((end - start) / HOP), Math.ceil(Math.abs(B.y - A.y) / 1.6), 1);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, edge = i === 0 || i === steps;
        const top = A.y + (B.y - A.y) * t + (edge ? 0 : (rand() - 0.5) * 0.8);
        blocks.push({ ...at(start + (end - start) * t, edge ? 0 : (rand() - 0.5) * 4), top, size: 4.5 + rand() * 1.5, depth: 1.2 + rand(), mat: mat(t) });
      }
      continue;
    }
    // Level blocks from one hub's edge to the other's.
    const start = HUB_SIZE / 2 + 7, end = len - start;
    const steps = Math.max(Math.ceil((end - start) / HOP), 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, edge = i === 0 || i === steps;
      blocks.push({ ...at(start + (end - start) * t, edge ? 0 : (rand() - 0.5) * 4), top: alt, size: 4.5 + rand() * 1.5, depth: 1.5, mat: mat(t) });
    }
  }

  // One low gate (crouch or slide under it) per bridge, where there is room
  // and no other bridge's blocks are close enough to get tangled up with it.
  for (const bridge of bridges) {
    const i = Math.floor(bridge.blocks.length / 2), mid = bridge.blocks[i];
    if (bridge.blocks.length < 7) continue;
    const prev = bridge.blocks[i - 1], next = bridge.blocks[i + 1];
    if (Math.hypot(prev.x - mid.x, prev.z - mid.z) < 9 || Math.hypot(next.x - mid.x, next.z - mid.z) < 9) continue;
    const crowded = bridges.some((other) => other !== bridge && other.blocks.some((o) =>
      Math.abs(o.x - mid.x) < 18 && Math.abs(o.z - mid.z) < 18 && Math.abs(o.top - mid.top) < 12));
    if (!crowded) { mid.gate = true; mid.size = 12; mid.depth = 2; }
  }

  // Blocks from bridges passing overhead must not plug a hub's shaft opening.
  const overShaft = (b) => hubs.some((h) => h &&
    Math.abs(b.x - h.x) < b.size / 2 + SHAFT + 1 && Math.abs(b.z - h.z) < b.size / 2 + SHAFT + 1);
  for (const bridge of bridges) {
    for (const b of bridge.blocks) {
      if (bridge.sky && overShaft(b)) continue;   // the hub covers this spot anyway
      addBlock(b.x, b.top - b.depth, b.z, b.size, b.depth, b.size, b.mat);
      if (!b.gate) continue;
      // Gate: a slab with only 1.25 of clearance, across the direction of travel.
      if (Math.abs(bridge.dx) > Math.abs(bridge.dz)) addBlock(b.x, b.top + 1.25, b.z, 1.2, 4, 12, whiteMat);
      else addBlock(b.x, b.top + 1.25, b.z, 12, 4, 1.2, whiteMat);
    }
  }

  // Hubs: a square platform with a hole in the middle, and under the hole a
  // four-walled shaft with the launch pad at the bottom. The walls stop you
  // drifting beneath the hub on the way up, and start above head height so
  // you can walk in underneath them.
  hubs.forEach((hub, i) => {
    if (!hub) return;
    const isl = islands[i], half = HUB_SIZE / 2, mat = blockMats[i % blockMats.length];
    const lip = SHAFT + 0.5;            // hub starts at the outside of the shaft walls
    const strip = half - lip;           // width of hub on each side of the hole
    addBlock(hub.x, hub.top - 1.5, hub.z + lip + strip / 2, HUB_SIZE, 1.5, strip, mat);
    addBlock(hub.x, hub.top - 1.5, hub.z - lip - strip / 2, HUB_SIZE, 1.5, strip, mat);
    addBlock(hub.x + lip + strip / 2, hub.top - 1.5, hub.z, strip, 1.5, lip * 2, mat);
    addBlock(hub.x - lip - strip / 2, hub.top - 1.5, hub.z, strip, 1.5, lip * 2, mat);
    const wallH = hub.top - (isl.y + 3), w = lip * 2;
    addBlock(hub.x, isl.y + 3, hub.z + SHAFT + 0.25, w, wallH, 0.5, padMat);
    addBlock(hub.x, isl.y + 3, hub.z - SHAFT - 0.25, w, wallH, 0.5, padMat);
    addBlock(hub.x + SHAFT + 0.25, isl.y + 3, hub.z, 0.5, wallH, SHAFT * 2, padMat);
    addBlock(hub.x - SHAFT - 0.25, isl.y + 3, hub.z, 0.5, wallH, SHAFT * 2, padMat);
    const rise = hub.top + 4 - (isl.y + 0.4);
    addBlock(hub.x, isl.y, hub.z, 3, 0.4, 3, padMat, { bounce: Math.sqrt(2 * GRAVITY * rise) });
    hub.pad = { x: hub.x, z: hub.z, top: isl.y + 0.4 };
  });
}

// ---------- Signboards ----------
const signs = [];   // { name, url, x, y, z, face, centre, normal, screen, group, dest?, question?, near? }
const SCREEN_Y = 2.5 + SIGN_H / 2;   // screen centre above the ground
const frameMat = new THREE.MeshLambertMaterial({ color: INK, flatShading: true });
const destFrameMat = new THREE.MeshLambertMaterial({ color: ACCENT, flatShading: true });
// Shown while a sign is too far away to be worth loading.
const idleScreenMat = (() => {
  const c = document.createElement('canvas');
  c.width = 160; c.height = 120;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 160, 120);
  x.fillStyle = '#d9d4c7';
  for (let i = 0; i < 7; i++) x.fillRect(12, 34 + i * 11, i % 3 === 2 ? 90 : 136, 5);
  x.fillStyle = '#1c1c1c';
  x.fillRect(0, 0, 160, 16);
  x.font = 'bold 10px "Courier New", monospace';
  x.fillStyle = '#ffffff';
  x.fillText('WALK CLOSER TO CONNECT', 8, 11);
  return new THREE.MeshBasicMaterial({ map: pixelTexture(c) });
})();
// Writes fully transparent pixels: the "window" the live iframe shows through.
const holeMat = new THREE.MeshBasicMaterial({
  color: 0x000000, opacity: 0, transparent: true, blending: THREE.NoBlending, fog: false,
});
const screenGeo = new THREE.PlaneGeometry(SIGN_W, SIGN_H);
const backGeo = new THREE.BoxGeometry(SIGN_W + 1, SIGN_H + 1, 0.5);
const postGeo = new THREE.BoxGeometry(0.7, SCREEN_Y, 0.7);
const headGeo = new THREE.PlaneGeometry(SIGN_W, 2);

const wikiUrl = (query) => 'https://en.wikipedia.org/wiki/Special:Search?go=Go&search=' + encodeURIComponent(query);

function makeSign({ name, url, x, y, z, face, dest = false }) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = face;
  const back = new THREE.Mesh(backGeo, dest ? destFrameMat : frameMat);
  back.position.set(0, SCREEN_Y, -0.5);
  const screen = new THREE.Mesh(screenGeo, idleScreenMat);
  screen.position.set(0, SCREEN_Y, 0);
  const head = new THREE.Mesh(headGeo, new THREE.MeshBasicMaterial({ map: labelTexture(name, dest ? '#d02818' : '#1c1c1c') }));
  head.position.set(0, SCREEN_Y + SIGN_H / 2 + 1.6, -0.2);
  group.add(back, screen, head);
  for (const sx of [-SIGN_W / 2 + 1, SIGN_W / 2 - 1]) {
    const post = new THREE.Mesh(postGeo, dest ? destFrameMat : frameMat);
    post.position.set(sx, SCREEN_Y / 2, -0.6);
    group.add(post);
  }
  scene.add(group);
  const sign = {
    name, url, x, y, z, face, dest, group, screen, head, site: null,
    centre: new THREE.Vector3(x, y + SCREEN_Y, z),
    normal: new THREE.Vector3(Math.sin(face), 0, Math.cos(face)),
  };
  signs.push(sign);
  return sign;
}

// Only the sign you are standing near carries a live page, so there is at
// most one iframe loaded at a time.
let activeSign = null;
function activate(sign) {
  if (activeSign === sign) return;
  if (activeSign) {
    activeSign.site.remove();
    activeSign.site = null;
    activeSign.screen.material = idleScreenMat;
  }
  activeSign = sign;
  if (!sign) return;
  const frame = document.createElement('iframe');
  frame.src = sign.url;
  frame.title = sign.name;
  frame.referrerPolicy = 'no-referrer';
  frame.style.cssText = `width:${SIGN_PX}px;height:${SIGN_PX * SIGN_H / SIGN_W}px;border:0;background:#fff;position:absolute;left:0;top:0;transform-origin:0 0;visibility:hidden`;
  sitesEl.appendChild(frame);
  sign.site = frame;
  // Page pixels -> world: centre the page on the board, flip y, scale to board size.
  const s = SIGN_W / SIGN_PX;
  sign.pageToWorld = new THREE.Matrix4()
    .makeRotationY(sign.face)
    .setPosition(sign.centre)
    .multiply(new THREE.Matrix4().makeTranslation(-SIGN_W / 2, SIGN_H / 2, 0))
    .multiply(new THREE.Matrix4().makeScale(s, -s, 1));
  sign.screen.material = holeMat;
}

// Lines the live page up with its board: one CSS matrix that takes page pixels
// through the world, the camera and the projection to window pixels.
const siteMatrix = new THREE.Matrix4(), toWindow = new THREE.Matrix4(), camDir = new THREE.Vector3();
function placeSite() {
  if (!activeSign) return;
  camera.updateMatrixWorld();
  camera.getWorldDirection(camDir);
  const ahead = activeSign.centre.clone().sub(camera.position).dot(camDir);
  if (ahead < 2) { activeSign.site.style.visibility = 'hidden'; return; }   // behind you
  toWindow.makeTranslation(innerWidth / 2, innerHeight / 2, 0)
    .multiply(new THREE.Matrix4().makeScale(innerWidth / 2, -innerHeight / 2, 1));
  siteMatrix.copy(toWindow)
    .multiply(camera.projectionMatrix)
    .multiply(camera.matrixWorldInverse)
    .multiply(activeSign.pageToWorld);
  activeSign.site.style.transform = `matrix3d(${siteMatrix.elements.map((n) => n.toFixed(8)).join(',')})`;
  activeSign.site.style.visibility = 'visible';
}

// ---------- Hand-held compass ----------
// Front face: the dial. Back face: brass plate the question is etched into.
const frontCanvas = document.createElement('canvas');
frontCanvas.width = frontCanvas.height = 128;
const backCanvas = document.createElement('canvas');
backCanvas.width = backCanvas.height = 256;
const frontTex = pixelTexture(frontCanvas), backTex = pixelTexture(backCanvas);
frontTex.minFilter = backTex.minFilter = THREE.NearestFilter;   // always seen close up: keep them crisp
frontTex.generateMipmaps = backTex.generateMipmaps = false;

const rig = new THREE.Group();          // moves between "held low" and "raised to read"
const compassBody = new THREE.Group();  // flips over to show the back
{
  handScene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const l = new THREE.DirectionalLight(0xffffff, 1.4);
  l.position.set(-0.5, 1, 1);
  handScene.add(l);

  const brass = new THREE.MeshLambertMaterial({ color: 0xb59a5a, flatShading: true });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.22, 24), brass);
  rim.rotation.x = Math.PI / 2;
  const front = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ map: frontTex }));
  front.position.z = 0.13;
  const back = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ map: backTex }));
  back.position.z = -0.13;
  back.rotation.y = Math.PI;
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 4, 8), brass);
  loop.position.y = 1.12;
  compassBody.add(rim, front, back, loop);

  const skin = new THREE.MeshLambertMaterial({ color: 0xe9c4a4, flatShading: true });
  const sleeve = new THREE.MeshLambertMaterial({ color: 0x3b3f4a, flatShading: true });
  const box = (w, h, d, mat, x, y, z, rz = 0, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    return m;
  };
  const hand = new THREE.Group();
  hand.add(
    // Open palm with the compass resting in it: four fingers behind, thumb on the rim.
    box(1.9, 1.9, 0.36, skin, 0, -0.55, -0.36),                  // palm
    box(0.44, 1.05, 0.32, skin, -0.72, 0.94, -0.36),             // index
    box(0.44, 1.25, 0.32, skin, -0.24, 1.04, -0.36),             // middle
    box(0.44, 1.15, 0.32, skin, 0.24, 0.99, -0.36),              // ring
    box(0.42, 0.85, 0.32, skin, 0.71, 0.84, -0.36),              // little
    box(0.4, 1.0, 0.3, skin, -1.2, -0.35, -0.1, 0.3),            // thumb, beside the rim
    box(1.3, 0.5, 0.3, skin, 0, -1.76, -0.36),                   // wrist
    box(1.6, 3.2, 0.85, sleeve, 0, -3.62, -0.36)                 // sleeve running off-screen
  );
  rig.add(hand, compassBody);
  handScene.add(rig);
}

// The needle is a damped spring, so it swings round to a new destination and settles.
const needle = { angle: 0, vel: 0 };
function swingNeedle(goal, dt, moving) {
  let diff = (goal - needle.angle) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  needle.vel += (diff * 30 - needle.vel * 3.5) * dt;
  if (moving) needle.vel += (Math.random() - 0.5) * 4 * dt;   // jostle while walking
  needle.angle += needle.vel * dt;
}

function drawCompassFace(heading) {
  const x = frontCanvas.getContext('2d');
  x.clearRect(0, 0, 128, 128);
  x.save();
  x.translate(64, 64);
  x.fillStyle = '#f7f4e9';
  x.fillRect(-64, -64, 128, 128);
  x.strokeStyle = '#1c1c1c';
  x.lineWidth = 3;
  x.beginPath(); x.arc(0, 0, 56, 0, Math.PI * 2); x.stroke();
  // The rose turns against your heading so N always points north.
  x.save();
  x.rotate(-heading);
  x.font = 'bold 18px "Courier New", monospace';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  ['N', 'E', 'S', 'W'].forEach((d, i) => {
    x.save();
    x.rotate(i * Math.PI / 2);
    x.fillStyle = d === 'N' ? '#d02818' : '#1c1c1c';
    x.fillText(d, 0, -42);
    x.restore();
  });
  x.fillStyle = '#1c1c1c';
  for (let i = 0; i < 16; i++) {
    x.save();
    x.rotate(i * Math.PI / 8 + Math.PI / 16);
    x.fillRect(-1, -55, 2, 6);
    x.restore();
  }
  x.restore();
  // Needle: red end points at the destination (or north until you have one).
  x.rotate(needle.angle);
  x.fillStyle = '#d02818';
  x.beginPath(); x.moveTo(0, -44); x.lineTo(11, 2); x.lineTo(-11, 2); x.closePath(); x.fill();
  x.fillStyle = '#1c1c1c';
  x.beginPath(); x.moveTo(0, 36); x.lineTo(9, 2); x.lineTo(-9, 2); x.closePath(); x.fill();
  x.fillStyle = '#b59a5a';
  x.beginPath(); x.arc(0, 0, 5, 0, Math.PI * 2); x.fill();
  x.restore();
  frontTex.needsUpdate = true;
}

// Etch text into the brass back: dark groove with a light lip below it.
function drawCompassBack(text, { cursor = false, note = '' } = {}) {
  const x = backCanvas.getContext('2d');
  x.fillStyle = '#c2a968';
  x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#8f7840';
  x.lineWidth = 2;
  for (const r of [118, 110]) { x.beginPath(); x.arc(128, 128, r, 0, Math.PI * 2); x.stroke(); }
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const etch = (str, px, y, alpha = 1) => {
    x.font = `bold ${px}px "Courier New", monospace`;
    x.globalAlpha = alpha;
    x.fillStyle = '#ecdcae';
    x.fillText(str, 129, y + 2);
    x.fillStyle = '#4a3b17';
    x.fillText(str, 128, y);
    x.globalAlpha = 1;
  };

  const shown = text.toUpperCase() + (cursor ? '_' : '');
  if (!text && !cursor) {
    etch('ASK', 34, 112, 0.5);
    etch('ANYTHING', 26, 146, 0.5);
  } else {
    const px = shown.length <= 20 ? 30 : shown.length <= 48 ? 24 : shown.length <= 90 ? 19 : 15;
    x.font = `bold ${px}px "Courier New", monospace`;
    const lines = [];
    let line = '';
    for (const word of shown.split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (x.measureText(next).width > 176 && line) { lines.push(line); line = word; }
      else line = next;
    }
    lines.push(line);
    const lh = px + 4;
    lines.forEach((ln, i) => etch(ln, px, 128 - ((lines.length - 1) * lh) / 2 + i * lh));
  }
  if (note) etch(note, 14, 44, 0.8);   // along the top, clear of the fingers
  backTex.needsUpdate = true;
}

// ---------- Player ----------
const player = {
  x: 0, y: 0, z: 0,            // feet
  vx: 0, vy: 0, vz: 0,
  yaw: 0, pitch: 0,
  h: STAND_H, eye: STAND_H - 0.15,
  grounded: false, coyote: 0, jumpBuffer: 0,
  wallTimer: 0, wallNx: 0, wallNz: 0,
  crouching: false, sliding: false, slideTimer: 0,
  safe: { x: 0, y: 0, z: 0 },   // last solid ground, for respawning
};
const keys = new Set();
let inspecting = false;   // compass turned over, typing a question
let browsing = null;      // the sign whose website you are using
let flip = 0;             // 0 = dial showing, 1 = back showing
let browseBlend = 0;      // 0 = first person, 1 = camera parked in front of a sign

function look(dx, dy) {
  player.yaw -= dx * 0.0025;
  player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch - dy * 0.0025));
}
// Click once to start looking: the cursor disappears and moving the mouse turns the camera.
// Esc gives the cursor back. Where the browser refuses a real pointer lock (embedded
// previews), the cursor is hidden instead and the screen edges keep you turning.
let looking = false;
let edgeX = 0, edgeY = 0;   // -1..1 when the hidden cursor is pushed against an edge
const lockMouse = () => { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {} };
function setLooking(on) {
  looking = on;
  edgeX = edgeY = 0;
  canvas.style.cursor = on ? 'none' : '';
  if (!on && document.pointerLockElement === canvas) document.exitPointerLock();
}
canvas.addEventListener('click', () => { lockMouse(); setLooking(true); });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && looking) setLooking(false);   // Esc released a real lock
});
document.addEventListener('pointermove', (e) => {
  if (!looking) return;
  look(e.movementX, e.movementY);
  if (document.pointerLockElement === canvas) return;
  const EDGE = 60;
  const push = (pos, size) => pos < EDGE ? (pos - EDGE) / EDGE : pos > size - EDGE ? (pos - (size - EDGE)) / EDGE : 0;
  edgeX = push(e.clientX, innerWidth);
  edgeY = push(e.clientY, innerHeight);
});
document.documentElement.addEventListener('pointerleave', () => { edgeX = edgeY = 0; });

function openCompass() {
  inspecting = true;
  keys.clear();
  qInput.value = '';
  qInput.focus();
  drawCompassBack('', { cursor: true, note: 'ENTER TO SEEK' });
}
function closeCompass() {
  inspecting = false;
  qInput.blur();
}
qInput.addEventListener('input', () => drawCompassBack(qInput.value, { cursor: true, note: 'ENTER TO SEEK' }));

// Browsing a sign: the camera parks in front of it, the mouse is released and
// the canvas stops catching clicks, so the page underneath works like any site.
function startBrowsing(sign) {
  activate(sign);
  browsing = sign;
  keys.clear();
  setLooking(false);
  canvas.style.pointerEvents = 'none';
  leaveBtn.classList.remove('hidden');
}
function stopBrowsing() {
  if (!browsing) return;
  browsing = null;
  canvas.style.pointerEvents = '';
  leaveBtn.classList.add('hidden');
  leaveBtn.blur();
  window.focus();   // take the keyboard back from the page
}
leaveBtn.addEventListener('click', stopBrowsing);
// A click on the empty space around the page also steps back.
sitesEl.addEventListener('pointerdown', (e) => {
  if (browsing && e.target.tagName !== 'IFRAME') stopBrowsing();
});

addEventListener('keydown', (e) => {
  if (!startEl.classList.contains('hidden')) return;
  if (browsing) {
    if (e.code === 'Escape' || e.code === 'KeyF') { e.preventDefault(); stopBrowsing(); }
    return;
  }
  if (e.code === 'Escape' && looking && !inspecting && pageEl.classList.contains('hidden')) {
    setLooking(false);
    return;
  }
  if (inspecting) {
    if (e.code === 'Escape') { e.preventDefault(); closeCompass(); }
    else if (e.code === 'Enter') { e.preventDefault(); seek(); }
    else if (document.activeElement !== qInput) qInput.focus();
    return;
  }
  if (e.code === 'KeyE') {
    e.preventDefault();   // keep the "e" out of the question
    openCompass();
    return;
  }
  if (e.code === 'Escape') { closePage(); return; }
  if (e.code === 'KeyF') { if (nearSign) startBrowsing(nearSign); return; }
  if (e.code === 'KeyG') {
    if (!pageEl.classList.contains('hidden')) closePage();
    else if (nearSign) askGuide(nearSign);
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) player.jumpBuffer = 0.14;
    return;
  }
  if (e.code === 'KeyC' && !e.repeat && player.grounded && !player.sliding &&
      Math.hypot(player.vx, player.vz) > SLIDE_MIN_SPEED) {
    // Crouching at a sprint turns into a slide.
    player.sliding = true;
    player.slideTimer = SLIDE_TIME;
    const boost = Math.min(SLIDE_BOOST, 38 / Math.hypot(player.vx, player.vz));
    player.vx *= boost;
    player.vz *= boost;
  }
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ---------- Physics ----------
const overlaps = (b, x, y, z, h) =>
  x + PLAYER_R > b.minX && x - PLAYER_R < b.maxX && y + h > b.minY && y < b.maxY &&
  z + PLAYER_R > b.minZ && z - PLAYER_R < b.maxZ;
const blockedAt = (x, y, z, h) => nearby(x, z).some((b) => overlaps(b, x, y, z, h));

function touchWall(nx, nz) {
  if (player.grounded) return;
  player.wallTimer = 0.2;
  player.wallNx = nx;
  player.wallNz = nz;
}

function physicsStep(dt, wishX, wishZ, wishSpeed) {
  const p = player;

  // Crouch / stand. You can only stand back up if there is headroom.
  const wantCrouch = keys.has('KeyC') || p.sliding;
  if (wantCrouch) p.crouching = true;
  else if (p.crouching && !blockedAt(p.x, p.y, p.z, STAND_H)) p.crouching = false;
  p.h = p.crouching ? CROUCH_H : STAND_H;

  // Horizontal velocity.
  if (p.sliding) {
    p.slideTimer -= dt;
    const sp = Math.hypot(p.vx, p.vz);
    const next = Math.max(0, sp - SLIDE_FRICTION * dt);
    if (sp > 0) { p.vx *= next / sp; p.vz *= next / sp; }
    if (p.slideTimer <= 0 || next < 7 || !keys.has('KeyC')) p.sliding = false;
  } else if (p.grounded) {
    const k = Math.min(1, 12 * dt);
    p.vx += (wishX * wishSpeed - p.vx) * k;
    p.vz += (wishZ * wishSpeed - p.vz) * k;
  } else if (wishX || wishZ) {
    const k = Math.min(1, 2.2 * dt);   // some steering in the air, but momentum carries
    p.vx += (wishX * Math.max(wishSpeed, WALK) - p.vx) * k;
    p.vz += (wishZ * Math.max(wishSpeed, WALK) - p.vz) * k;
  }

  // Jump, or kick off a wall when airborne.
  p.jumpBuffer -= dt;
  p.coyote -= dt;
  p.wallTimer -= dt;
  if (p.jumpBuffer > 0) {
    if (p.grounded || p.coyote > 0) {
      p.vy = JUMP;
      p.grounded = false;
      p.coyote = 0;
      p.jumpBuffer = 0;
      p.sliding = false;
    } else if (p.wallTimer > 0) {
      const into = p.vx * p.wallNx + p.vz * p.wallNz;   // drop any speed into the wall
      p.vx += (WALL_JUMP_OUT - into) * p.wallNx;
      p.vz += (WALL_JUMP_OUT - into) * p.wallNz;
      p.vy = WALL_JUMP_UP;
      p.wallTimer = 0;
      p.jumpBuffer = 0;
    }
  }

  p.vy -= GRAVITY * dt;
  if (p.wallTimer > 0.15 && p.vy < -WALL_SLIDE_MAX_FALL) p.vy = -WALL_SLIDE_MAX_FALL;   // cling and slide

  // Move one axis at a time and push out of anything solid.
  p.x += p.vx * dt;
  for (const b of nearby(p.x, p.z)) {
    if (!overlaps(b, p.x, p.y, p.z, p.h)) continue;
    if (p.grounded && b.maxY - p.y <= 0.5 && !blockedAt(p.x, b.maxY, p.z, p.h)) { p.y = b.maxY; continue; }   // step up
    if (p.vx > 0) { p.x = b.minX - PLAYER_R; touchWall(-1, 0); }
    else if (p.vx < 0) { p.x = b.maxX + PLAYER_R; touchWall(1, 0); }
    p.vx = 0;
  }
  p.z += p.vz * dt;
  for (const b of nearby(p.x, p.z)) {
    if (!overlaps(b, p.x, p.y, p.z, p.h)) continue;
    if (p.grounded && b.maxY - p.y <= 0.5 && !blockedAt(p.x, b.maxY, p.z, p.h)) { p.y = b.maxY; continue; }
    if (p.vz > 0) { p.z = b.minZ - PLAYER_R; touchWall(0, -1); }
    else if (p.vz < 0) { p.z = b.maxZ + PLAYER_R; touchWall(0, 1); }
    p.vz = 0;
  }
  // Island sides are round walls.
  for (const isl of islands) {
    if (p.y >= isl.y - 0.001 || p.y + p.h <= isl.y - ISLAND_DEPTH) continue;
    const dx = p.x - isl.x, dz = p.z - isl.z;
    const d = Math.hypot(dx, dz);
    if (d >= isl.r + PLAYER_R || d < 0.001) continue;
    if (isl.y - p.y <= 0.6) { p.y = isl.y; continue; }   // close enough to the lip: climb on
    const nx = dx / d, nz = dz / d;
    p.x = isl.x + nx * (isl.r + PLAYER_R);
    p.z = isl.z + nz * (isl.r + PLAYER_R);
    const into = p.vx * nx + p.vz * nz;
    if (into < 0) { p.vx -= into * nx; p.vz -= into * nz; }
    touchWall(nx, nz);
  }

  const prevY = p.y;
  const wasGrounded = p.grounded;
  p.y += p.vy * dt;
  p.grounded = false;
  let bounce = 0;
  for (const b of nearby(p.x, p.z)) {
    if (!overlaps(b, p.x, p.y, p.z, p.h)) continue;
    if (p.vy <= 0 && prevY >= b.maxY - 1e-4) { p.y = b.maxY; p.vy = 0; p.grounded = true; bounce = b.bounce || bounce; }
    else if (p.vy > 0) { p.y = b.minY - p.h; p.vy = 0; }
  }
  if (bounce) {   // launch pad: thrown straight up, steer in the air
    p.vy = bounce;
    p.grounded = false;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.sliding = false;
  }
  for (const isl of islands) {
    if (p.vy > 0 || p.y >= isl.y || prevY < isl.y - 1e-4) continue;
    if (Math.hypot(p.x - isl.x, p.z - isl.z) < isl.r) { p.y = isl.y; p.vy = 0; p.grounded = true; }
  }
  if (bounce) {
    // in the air: nothing to record
  } else if (p.grounded) {
    p.coyote = 0.1;
    if (!p.sliding) { p.safe.x = p.x; p.safe.y = p.y; p.safe.z = p.z; }
  } else if (wasGrounded && p.vy <= 0) {
    p.coyote = 0.1;   // just walked off a ledge: brief grace to still jump
  }

  // Fell into the void: back to the last solid ground.
  if (p.y < ABYSS_Y + 12) {
    Object.assign(p, { x: p.safe.x, y: p.safe.y + 0.1, z: p.safe.z, vx: 0, vy: 0, vz: 0, sliding: false });
  }
}

// ---------- Destination ----------
let target = null;      // { x, y, z, question, near, visited, sign }
let nearSign = null;    // sign close enough to browse
const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.8, 0.8, 900, 6, 1, true),
  new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.7, fog: false, side: THREE.DoubleSide })
);
beam.visible = false;
scene.add(beam);

function setTarget(data) {
  if (target?.sign) {
    if (activeSign === target.sign) activate(null);
    if (browsing === target.sign) stopBrowsing();
    scene.remove(target.sign.group);
    target.sign.head.material.map.dispose();
    signs.splice(signs.indexOf(target.sign), 1);
  }
  const { x, y, z } = data.target;
  // The destination board faces the way you will arrive from.
  const face = Math.atan2(player.x - x, player.z - z);
  const sign = makeSign({ name: data.question, url: wikiUrl(data.question), x, y, z, face, dest: true });
  target = { x, y, z, question: data.question, near: data.near.map((n) => n.name), visited: false, sign };
  sign.question = data.question;
  sign.near = target.near;
  beam.position.set(x - Math.sin(face) * 1.5, y + 450 + SCREEN_Y + SIGN_H / 2 + 3, z - Math.cos(face) * 1.5);
  beam.visible = true;
}

let seeking = false;
async function seek() {
  const question = qInput.value.trim();
  if (!question || seeking) return;
  seeking = true;
  drawCompassBack(question, { note: 'SEEKING...' });
  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    setTarget(await res.json());
    drawCompassBack(question);   // the question stays etched on the back
    closeCompass();
  } catch (err) {
    drawCompassBack(question, { cursor: true, note: 'NO SIGNAL. TRY AGAIN' });
  } finally {
    seeking = false;
  }
}

// ---------- Guide pages (streamed LLM answers) ----------
let pageAbort = null;
async function openPage(title, question, near) {
  pageAbort?.abort();
  pageAbort = new AbortController();
  pageTitle.textContent = title;
  pageBody.textContent = '';
  pageStatus.textContent = 'Connecting to host...';
  pageEl.classList.remove('hidden');
  try {
    const res = await fetch('/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, near }),
      signal: pageAbort.signal,
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    pageStatus.textContent = 'Transferring data...';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pageBody.textContent += decoder.decode(value, { stream: true });
      pageBody.scrollTop = pageBody.scrollHeight;
    }
    pageStatus.textContent = 'Document: Done';
  } catch (err) {
    if (err.name !== 'AbortError') pageStatus.textContent = 'Transfer interrupted';
  }
}
function closePage() {
  pageAbort?.abort();
  pageEl.classList.add('hidden');
}
$('page-close').addEventListener('click', closePage);

function askGuide(sign) {
  if (sign.dest) return openPage(sign.question, sign.question, sign.near);
  const near = signs
    .filter((s) => s !== sign && !s.dest)
    .map((s) => ({ s, d: Math.hypot(s.x - sign.x, s.z - sign.z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4)
    .map((n) => n.s.name);
  openPage(sign.name, `Tell me about ${sign.name}.`, near);
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  const p = player;

  // Input -> the direction and speed you want to move at.
  let wishX = 0, wishZ = 0, wishSpeed = 0;
  const free = !inspecting && !browsing;
  if (free) {
    if (looking && (edgeX || edgeY)) look(edgeX * 900 * dt, edgeY * 500 * dt);
    if (keys.has('ArrowLeft')) p.yaw += 1.8 * dt;
    if (keys.has('ArrowRight')) p.yaw -= 1.8 * dt;
    const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    if (f || s) {
      const len = Math.hypot(f, s), sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
      wishX = (-sin * f + cos * s) / len;
      wishZ = (-cos * f - sin * s) / len;
      wishSpeed = p.crouching ? CROUCH_SPEED : keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT : WALK;
    }
  }
  // Small fixed steps so fast movement cannot pass through thin walls.
  const steps = Math.max(1, Math.ceil(dt / 0.016));
  for (let i = 0; i < steps; i++) physicsStep(dt / steps, wishX, wishZ, wishSpeed);
  const moving = p.grounded && Math.hypot(p.vx, p.vz) > 2;

  // Signs: load the nearest one's website; note the one close enough to use.
  let closest = null, closestD = SIGN_LOAD_DIST;
  for (const s of signs) {
    const d = Math.hypot(s.centre.x - p.x, s.centre.z - p.z) + Math.abs(s.y - p.y) * 2;
    if (d < closestD) { closestD = d; closest = s; }
  }
  if (!browsing) activate(closest);
  nearSign = closest && closestD < SIGN_USE_DIST ? closest : null;
  hintEl.textContent = nearSign && free && pageEl.classList.contains('hidden')
    ? `[F] Browse: ${nearSign.name}   [G] Guide` : '';

  // Camera: first person, or parked square-on in front of the sign being browsed.
  browseBlend = Math.max(0, Math.min(1, browseBlend + (browsing ? 1 : -1) * dt * 3));
  p.eye += ((p.h - 0.15) - p.eye) * Math.min(1, 14 * dt);
  const bob = moving && !p.sliding ? Math.sin(t * 11) * 0.07 : 0;
  camera.position.set(p.x, p.y + p.eye + bob, p.z);
  camera.rotation.set(p.pitch, p.yaw, p.sliding ? 0.07 : 0);
  const viewSign = browsing || (browseBlend > 0 ? activeSign : null);
  if (viewSign && browseBlend > 0) {
    const b = smooth(browseBlend);
    // Back off far enough that the whole board fits, whatever the window shape.
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(SIGN_H / 2 / tan, SIGN_W / 2 / (tan * camera.aspect)) * 1.12;
    camera.position.lerp(viewSign.centre.clone().addScaledVector(viewSign.normal, dist), b);
    camera.rotation.set(lerp(p.pitch, 0, b), lerpAngle(p.yaw, viewSign.face, b), 0);
  }
  sky.position.set(p.x, 0, p.z);
  beam.material.opacity = 0.5 + Math.sin(t * 6) * 0.2;

  // Heading and bearing are clockwise from north (-z).
  const heading = -p.yaw;
  let bearing = null;
  if (target) {
    const dx = target.x - p.x, dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    bearing = Math.atan2(dx, -dz);
    if (!target.visited) {
      destEl.textContent = `${Math.round(dist)}m > ${target.question}`;
      if (dist < ARRIVE_DIST && Math.abs(p.y - target.y) < 3) {
        target.visited = true;
        destEl.textContent = `Arrived > ${target.question}`;
      }
    }
  } else {
    destEl.textContent = '[E] Turn the compass over to ask';
  }
  if (inspecting) destEl.textContent = 'Type your question';
  if (browsing) destEl.textContent = '';   // keep the page clear while you read it
  swingNeedle((bearing ?? 0) - heading, dt, moving);
  drawCompassFace(heading);

  // Compass pose: held low by default, raised and flipped while asking.
  flip = Math.max(0, Math.min(1, flip + (inspecting ? 1 : -1) * dt * 3.5));
  const e = smooth(flip);
  const sway = moving ? Math.sin(t * 11) * 0.012 : Math.sin(t * 1.5) * 0.004;
  const restX = Math.min(0.5, 0.3 * handCam.aspect);   // stay in frame on narrow windows
  rig.position.set(lerp(restX, 0, e), lerp(-0.2, -0.02, e) + sway - browseBlend * 1.2, lerp(-1.5, -1.25, e));
  rig.rotation.set(lerp(-0.7, -0.1, e), lerp(-0.2, 0, e), 0);
  rig.scale.setScalar(lerp(0.23, 0.34, e));
  compassBody.rotation.y = e * Math.PI;

  renderer.clear();
  renderer.render(scene, camera);
  placeSite();
  renderer.clearDepth();
  renderer.render(handScene, handCam);
  requestAnimationFrame(tick);
}

// ---------- Boot ----------
$('enter').addEventListener('click', () => {
  startEl.classList.add('hidden');
  lockMouse();
  setLooking(true);
});

const map = await (await fetch('/api/map')).json();
buildIslands(map.islands);
buildBridges();
drawBlocks();
for (const l of map.landmarks) makeSign({ ...l, url: wikiUrl(l.name) });

// Start on the island nearest the middle of the archipelago, facing its tower.
const home = [...islands].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
Object.assign(player, { x: home.x, y: home.y, z: home.z + 28 });
Object.assign(player.safe, { x: player.x, y: player.y, z: player.z });

drawCompassBack('');
window.vectorWeb = { player, islands, signs, colliders, bridges, hubs, keys, physicsStep, nearby, get target() { return target; } }; // handy in the console
tick();
