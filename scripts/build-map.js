// Builds data/map.json: every concept in data/concepts.txt gets an embedding
// and a 2D world position (UMAP), so similar ideas end up near each other.
// Run with: npm run build-map
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import umap from 'umap-js';
import { embed } from '../lib/embed.js';

const { UMAP } = umap;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ISLAND_RADIUS = 70;     // size of each topic island
const RING_RADIUS = 62;       // signboards stand on this ring
const ISLAND_SPACING = 185;   // minimum distance between island centres

// Parse "# Category" headers followed by one concept per line.
const concepts = [];
const categories = [];
for (const raw of fs.readFileSync(path.join(root, 'data/concepts.txt'), 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line) continue;
  if (line.startsWith('#')) categories.push(line.slice(1).trim());
  else concepts.push({ name: line, cat: categories.length - 1 });
}
console.log(`Embedding ${concepts.length} concepts in ${categories.length} categories...`);

const vectors = [];
for (let i = 0; i < concepts.length; i += 32) {
  vectors.push(...(await embed(concepts.slice(i, i + 32).map((c) => c.name))));
}

// Seeded RNG so the map is the same on every build.
let seed = 1337;
const random = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

console.log('Laying out the world with UMAP...');
const layout = new UMAP({ nComponents: 2, nNeighbors: 12, minDist: 0.5, spread: 1.5, random }).fit(vectors);

// One floating island per category. Island centres start at each category's
// centroid in the UMAP layout (so related topics are neighbours), then get
// pushed apart until there is room for bridges between them.
const groups = categories.map(() => []);
concepts.forEach((c, i) => groups[c.cat].push(i));
const centroid = (g) => [
  g.reduce((s, i) => s + layout[i][0], 0) / g.length,
  g.reduce((s, i) => s + layout[i][1], 0) / g.length,
];
const raw = groups.map(centroid);
let centres = raw.map((p) => [...p]);

const nearestGap = (pts) => pts.map((p, i) =>
  Math.min(...pts.filter((_, j) => j !== i).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))));
const gaps = nearestGap(centres).sort((a, b) => a - b);
const scale = ISLAND_SPACING / gaps[Math.floor(gaps.length / 2)];
centres = centres.map((p) => [p[0] * scale, p[1] * scale]);
for (let iter = 0; iter < 1500; iter++) {
  // Gentle pull to the middle keeps the archipelago compact.
  const ax = centres.reduce((s, p) => s + p[0], 0) / centres.length;
  const az = centres.reduce((s, p) => s + p[1], 0) / centres.length;
  for (const p of centres) { p[0] -= (p[0] - ax) * 0.01; p[1] -= (p[1] - az) * 0.01; }
  for (let i = 0; i < centres.length; i++) {
    for (let j = i + 1; j < centres.length; j++) {
      const dx = centres[j][0] - centres[i][0], dz = centres[j][1] - centres[i][1];
      const d = Math.hypot(dx, dz) || 1;
      if (d >= ISLAND_SPACING) continue;
      const push = (ISLAND_SPACING - d) / 2 / d;
      centres[i][0] -= dx * push; centres[i][1] -= dz * push;
      centres[j][0] += dx * push; centres[j][1] += dz * push;
    }
  }
}
const mx = centres.reduce((s, p) => s + p[0], 0) / centres.length;
const mz = centres.reduce((s, p) => s + p[1], 0) / centres.length;

const islands = categories.map((name, k) => ({
  name,
  x: +(centres[k][0] - mx).toFixed(1),
  z: +(centres[k][1] - mz).toFixed(1),
  y: Math.round(random() * 14),
  r: ISLAND_RADIUS,
}));

// Each landmark is a signboard on its island's rim, facing the middle.
// Order round the ring follows the UMAP angle, so neighbours stay related.
const landmarks = new Array(concepts.length);
groups.forEach((g, k) => {
  const isl = islands[k];
  const angle = (i) => Math.atan2(layout[i][1] - raw[k][1], layout[i][0] - raw[k][0]);
  const sorted = [...g].sort((a, b) => angle(a) - angle(b));
  sorted.forEach((i, n) => {
    const a = angle(sorted[0]) + (n / sorted.length) * Math.PI * 2;
    landmarks[i] = {
      name: concepts[i].name,
      cat: k,
      x: +(isl.x + Math.cos(a) * RING_RADIUS).toFixed(1),
      y: isl.y,
      z: +(isl.z + Math.sin(a) * RING_RADIUS).toFixed(1),
      face: +Math.atan2(-Math.cos(a), -Math.sin(a)).toFixed(3),   // sign normal points at the centre
      v: vectors[i].map((n) => +n.toFixed(4)),
    };
  });
});

fs.writeFileSync(path.join(root, 'data/map.json'), JSON.stringify({ categories, islands, landmarks }));
console.log(`Wrote data/map.json (${landmarks.length} landmarks on ${islands.length} islands).`);
