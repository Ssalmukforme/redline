import { LIMIT } from './simulation.js';

// Golden Bay is described as free-form road polylines. Crossings are detected automatically,
// dead-end stubs are trimmed, and the result is one connected road graph used for rendering,
// police routing and building placement.

const SEGMENT = 11;

function catmull(points, closed = false, step = 7) {
  const p = closed ? [points.at(-1), ...points, points[0], points[1]] : [points[0], ...points, points.at(-1)];
  const out = [];
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(closed ? [...points[0]] : [...points.at(-1)]);
  return out;
}

// Downtown streets live on a rotated frame and are gently warped so no avenue is perfectly straight.
export const DOWNTOWN = { x: -10, z: -40, angle: .2 };
function downtown(u, v) {
  const c = Math.cos(DOWNTOWN.angle), s = Math.sin(DOWNTOWN.angle);
  const x = DOWNTOWN.x + u * c - v * s, z = DOWNTOWN.z + u * s + v * c;
  return [x + Math.sin(z * .014) * 13, z + Math.sin(x * .012 + 1) * 11];
}
export function inDowntown(x, z) {
  const c = Math.cos(DOWNTOWN.angle), s = Math.sin(DOWNTOWN.angle), dx = x - DOWNTOWN.x, dz = z - DOWNTOWN.z;
  const u = dx * c + dz * s, v = -dx * s + dz * c;
  return u > -150 && u < 150 && v > -185 && v < 190;
}
const line = (pts, step = 8) => {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const n = Math.max(1, Math.ceil(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) / step));
    for (let k = 0; k < n; k++) out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / n]);
  }
  out.push(pts.at(-1));
  return out;
};

export function defineRoads() {
  const roads = [];
  const road = (pts, w, kind) => roads.push({ pts, w, kind });
  // Coastal ring road: hugs the sea on the west and wanders through the hills elsewhere.
  road(catmull([[-320, -330], [-120, -352], [80, -326], [300, -342], [352, -150], [328, 60], [354, 250], [300, 350], [80, 334], [-150, 355], [-330, 330], [-346, 120], [-322, -80], [-352, -220]], true), 20, 'ring');
  // Grand boulevard slicing diagonally from the south-west beach to the north-east hills.
  road(catmull([[-390, 395], [-150, 160], [20, -20], [170, -190], [395, -395]]), 24, 'boulevard');
  // Downtown: an irregular, warped street pattern with partial blocks.
  const dt = (pts, w = 16) => road(line(pts.map(([u, v]) => [u, v])).map(([u, v]) => downtown(u, v)), w, 'downtown');
  for (const [u, v0, v1] of [[-130, -178, 183], [-45, -178, 98], [45, -93, 183], [135, -178, 98]]) dt([[u, v0], [u, v1]]);
  for (const [v, u0, u1] of [[-170, -138, 143], [-85, -138, 53], [0, -53, 143], [90, -138, 143], [175, -138, 53]]) dt([[u0, v], [u1, v]]);
  // Connectors that overshoot on purpose; stubs are trimmed after crossings are found.
  road(catmull([[-400, -20], [-260, -45], [-180, -10], [-110, 12]]), 16, 'avenue');
  road(catmull([[-400, -150], [-290, -168], [-210, -120], [-112, -118]]), 14, 'street');
  road(catmull([[-40, -400], [-20, -300], [25, -192]]), 16, 'avenue');
  road(catmull([[-400, -215], [-250, -252], [-130, -292], [0, -282], [120, -250], [260, -272], [400, -240]]), 18, 'industrial');
  road(catmull([[90, 20], [165, -22], [222, 12], [275, -38], [325, 2], [400, -15]]), 13, 'hill');
  road(catmull([[190, 120], [250, 95], [302, 140], [292, 212], [230, 232], [184, 186]], true), 13, 'hill');
  road(catmull([[30, 50], [80, 95], [150, 140], [245, 165], [330, 150], [400, 170]]), 14, 'hill');
  road(catmull([[250, 215], [228, 285], [262, 400]]), 13, 'hill');
  road(catmull([[-400, 230], [-250, 215], [-120, 250], [0, 218], [110, 256], [200, 300], [400, 290]]), 15, 'suburb');
  road(catmull([[-110, 60], [-120, 150], [-80, 270], [-110, 400]]), 14, 'suburb');
  road(catmull([[60, 40], [50, 130], [62, 200], [40, 280], [70, 400]]), 14, 'suburb');
  road(catmull([[-250, -400], [-240, -262], [-272, -190], [-232, -60], [-252, 60], [-220, 160], [-252, 215], [-262, 250]]), 14, 'coast');
  return roads;
}

export function buildNetwork(roads) {
  const nodes = [], grid = new Map(), key = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
  function node(x, z) {
    const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const id of grid.get(`${cx + i},${cz + j}`) || []) if (Math.hypot(nodes[id].x - x, nodes[id].z - z) < 1.6) return id;
    nodes.push({ x, z }); const k = key(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(nodes.length - 1);
    return nodes.length - 1;
  }
  const segs = [];
  for (const r of roads) for (let i = 0; i < r.pts.length - 1; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / SEGMENT));
    for (let k = 0; k < n; k++) segs.push({ ax: ax + (bx - ax) * k / n, az: az + (bz - az) * k / n, bx: ax + (bx - ax) * (k + 1) / n, bz: az + (bz - az) * (k + 1) / n, w: r.w, kind: r.kind, cuts: [] });
  }
  const bucket = new Map();
  segs.forEach((s, i) => {
    for (let cx = Math.floor(Math.min(s.ax, s.bx) / 24); cx <= Math.floor(Math.max(s.ax, s.bx) / 24); cx++)
      for (let cz = Math.floor(Math.min(s.az, s.bz) / 24); cz <= Math.floor(Math.max(s.az, s.bz) / 24); cz++) {
        const k = `${cx},${cz}`; if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(i);
      }
  });
  const tested = new Set();
  for (const list of bucket.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const i = Math.min(list[a], list[b]), j = Math.max(list[a], list[b]), pair = i * 100000 + j;
    if (tested.has(pair)) continue; tested.add(pair);
    const s = segs[i], t = segs[j];
    const rx = s.bx - s.ax, rz = s.bz - s.az, qx = t.bx - t.ax, qz = t.bz - t.az, den = rx * qz - rz * qx;
    if (Math.abs(den) < 1e-6) continue;
    const u = ((t.ax - s.ax) * qz - (t.az - s.az) * qx) / den, v = ((t.ax - s.ax) * rz - (t.az - s.az) * rx) / den;
    if (u < -1e-6 || u > 1 + 1e-6 || v < -1e-6 || v > 1 + 1e-6) continue;
    const id = node(s.ax + rx * u, s.az + rz * u);
    s.cuts.push([u, id]); t.cuts.push([v, id]);
  }
  const edgeMap = new Map();
  for (const s of segs) {
    const ids = [node(s.ax, s.az), ...s.cuts.sort((a, b) => a[0] - b[0]).map(c => c[1]), node(s.bx, s.bz)];
    for (let k = 0; k < ids.length - 1; k++) {
      const a = ids[k], b = ids[k + 1]; if (a === b) continue;
      const ek = a < b ? `${a}-${b}` : `${b}-${a}`;
      const prev = edgeMap.get(ek); if (!prev || prev.w < s.w) edgeMap.set(ek, { a, b, w: s.w, kind: s.kind });
    }
  }
  // Trim dead ends repeatedly, then keep the largest connected piece of the city.
  const adj = nodes.map(() => new Set());
  for (const e of edgeMap.values()) { adj[e.a].add(e.b); adj[e.b].add(e.a); }
  const alive = nodes.map(() => true), queue = [];
  adj.forEach((n, i) => { if (n.size < 2) queue.push(i); });
  while (queue.length) {
    const i = queue.pop(); if (!alive[i] || adj[i].size >= 2) continue;
    alive[i] = false;
    for (const j of adj[i]) { adj[j].delete(i); if (adj[j].size < 2) queue.push(j); }
    adj[i].clear();
  }
  const component = new Int32Array(nodes.length).fill(-1); let best = -1, bestSize = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (!alive[i] || component[i] >= 0) continue;
    const stack = [i]; component[i] = i; let size = 0;
    while (stack.length) { const u = stack.pop(); size++; for (const v of adj[u]) if (component[v] < 0) { component[v] = i; stack.push(v); } }
    if (size > bestSize) { bestSize = size; best = i; }
  }
  const remap = new Int32Array(nodes.length).fill(-1), outNodes = [];
  nodes.forEach((n, i) => { if (component[i] === best) { remap[i] = outNodes.length; outNodes.push({ x: n.x, z: n.z, w: 0, degree: adj[i].size }); } });
  const edges = [];
  for (const e of edgeMap.values()) {
    const a = remap[e.a], b = remap[e.b]; if (a < 0 || b < 0 || !adj[e.a].has(e.b)) continue;
    const length = Math.hypot(outNodes[a].x - outNodes[b].x, outNodes[a].z - outNodes[b].z);
    edges.push({ a, b, w: e.w, kind: e.kind, length });
    outNodes[a].w = Math.max(outNodes[a].w, e.w); outNodes[b].w = Math.max(outNodes[b].w, e.w);
  }
  const links = outNodes.map(() => []);
  for (const e of edges) { links[e.a].push([e.b, e.length]); links[e.b].push([e.a, e.length]); }
  return { nodes: outNodes, edges, adj: links };
}

// Spatial lookup of distance to the nearest road edge (negative when on the asphalt).
function roadIndex(network) {
  const CELL = 32, cells = new Map();
  network.edges.forEach((e, i) => {
    const a = network.nodes[e.a], b = network.nodes[e.b], pad = 30;
    for (let cx = Math.floor((Math.min(a.x, b.x) - pad) / CELL); cx <= Math.floor((Math.max(a.x, b.x) + pad) / CELL); cx++)
      for (let cz = Math.floor((Math.min(a.z, b.z) - pad) / CELL); cz <= Math.floor((Math.max(a.z, b.z) + pad) / CELL); cz++) {
        const k = cx * 4096 + cz; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i);
      }
  });
  return (x, z) => {
    let best = 99;
    for (const i of cells.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL)) || []) {
      const e = network.edges[i], a = network.nodes[e.a], b = network.nodes[e.b];
      const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t) - e.w / 2);
    }
    return best;
  };
}

// Oriented rectangles use three.js rotation.y: local x maps to (cos r, -sin r).
export function rectsOverlap(a, b, gap = 0) {
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const ang of [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2]) {
    const ext = o => o.w / 2 * Math.abs(Math.cos(o.rot - ang)) + o.d / 2 * Math.abs(Math.sin(o.rot - ang));
    if (Math.abs(dx * Math.cos(ang) - dz * Math.sin(ang)) >= ext(a) + ext(b) + gap) return false;
  }
  return true;
}

export const PARKS = [{ x: -8, z: -48, r: 26 }, { x: 244, z: 162, r: 40 }, { x: -292, z: 60, r: 34 }, { x: 120, z: -300, r: 26 }, { x: -170, z: 300, r: 30 }];

export function districtAt(x, z) {
  if (inDowntown(x, z)) return 'downtown';
  if (z < -236) return 'industrial';
  if (x < -190) return 'coast';
  if (x > 170) return 'hills';
  return 'suburb';
}

export function createCity(seed = 97) {
  let state = seed;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  const roads = defineRoads(), network = buildNetwork(roads), clearance = roadIndex(network);
  const buildings = [], trees = [], lamps = [], palms = [], parked = [];
  const CELL = 48, placed = new Map();
  const near = (x, z) => { const out = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(placed.get((Math.floor(x / CELL) + i) * 4096 + Math.floor(z / CELL) + j) || [])); return out; };
  const remember = o => { const k = Math.floor(o.x / CELL) * 4096 + Math.floor(o.z / CELL); if (!placed.has(k)) placed.set(k, []); placed.get(k).push(o); };
  const junctions = network.nodes.filter(n => n.degree >= 3);
  const nearJunction = (x, z, r) => junctions.some(n => Math.abs(n.x - x) < r && Math.abs(n.z - z) < r && Math.hypot(n.x - x, n.z - z) < r);
  const inBounds = (x, z, pad) => Math.abs(x) < LIMIT - pad && Math.abs(z) < LIMIT - pad;
  const inPark = (x, z, pad = 0) => PARKS.some(p => Math.hypot(p.x - x, p.z - z) < p.r + pad);

  function tryBuilding(b) {
    const reach = Math.hypot(b.w, b.d) / 2;
    if (!inBounds(b.x, b.z, reach + 3) || inPark(b.x, b.z, reach * .6)) return false;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    for (const [u, v] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const lx = u * b.w / 2, lz = v * b.d / 2;
      if (clearance(b.x + lx * c + lz * s, b.z - lx * s + lz * c) < 4.2) return false;
    }
    // Either a real alley (wider than a car) or nothing: narrow slots are where cars get wedged.
    for (const o of near(b.x, b.z)) if (rectsOverlap(o, b, 5)) return false;
    buildings.push(b); remember(b); return true;
  }
  const sizes = {
    downtown: () => ({ w: 16 + rand() * 12, d: 15 + rand() * 10 }),
    industrial: () => ({ w: 22 + rand() * 16, d: 18 + rand() * 12 }),
    coast: () => ({ w: 11 + rand() * 8, d: 10 + rand() * 7 }),
    hills: () => ({ w: 9 + rand() * 5, d: 8 + rand() * 5 }),
    suburb: () => ({ w: 10 + rand() * 6, d: 9 + rand() * 6 }),
  };
  const heights = {
    downtown: (x, z) => { const r = Math.hypot(x - DOWNTOWN.x, z - DOWNTOWN.z); return 14 + rand() * 16 + Math.max(0, 1 - r / 210) * (25 + rand() * 45); },
    industrial: () => 7 + rand() * 7,
    coast: () => 6 + rand() * 11,
    hills: () => 5 + rand() * 3,
    suburb: () => 5 + rand() * 4,
  };
  // Frontage: walk each road's centreline and line both sides with buildings facing the street.
  for (const r of roads) {
    const pts = r.pts, cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const at = t => {
      let i = 1; while (i < cum.length - 1 && cum[i] < t) i++;
      const a = pts[i - 1], b = pts[i], len = cum[i] - cum[i - 1] || 1, f = (t - cum[i - 1]) / len;
      return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, dx: (b[0] - a[0]) / len, dz: (b[1] - a[1]) / len };
    };
    for (const row of [0, 1]) for (const side of [-1, 1]) {
      let t = rand() * 8;
      while (t < cum.at(-1)) {
        const probe = at(t), district = districtAt(probe.x, probe.z), size = sizes[district]();
        const p = at(t + size.w / 2), nx = -p.dz * side, nz = p.dx * side;
        const setback = r.w / 2 + 4.8 + size.d / 2 + row * (24 + rand() * 6);
        const x = p.x + nx * setback, z = p.z + nz * setback;
        const b = { x, z, ...size, rot: Math.atan2(-p.dz, p.dx), district, h: heights[district](x, z), tone: rand() };
        t += tryBuilding(b) ? size.w + 2.5 + rand() * (district === 'downtown' ? 3 : 8) : 5;
      }
    }
  }
  // Trees fill parks, hillsides and the gaps between houses.
  const density = { downtown: .05, industrial: .08, coast: .22, hills: .5, suburb: .28 };
  for (let x = -LIMIT + 10; x < LIMIT - 10; x += 9) for (let z = -LIMIT + 10; z < LIMIT - 10; z += 9) {
    const tx = x + (rand() - .5) * 7, tz = z + (rand() - .5) * 7, district = districtAt(tx, tz);
    const chance = inPark(tx, tz) ? .72 : density[district];
    if (rand() > chance || clearance(tx, tz) < 5.5) continue;
    const tree = { x: tx, z: tz, w: 1.6, d: 1.6, rot: 0, scale: .8 + rand() * .6, pine: district === 'hills' ? rand() < .7 : rand() < .15 };
    if (near(tx, tz).some(o => rectsOverlap(o, tree, o.h ? 4 : 2.5))) continue;
    trees.push(tree); remember(tree);
  }
  // Zebra crossings on each approach to a junction, skipping any that would overlap another crossing or junction.
  const crosswalks = [];
  network.nodes.forEach((n, id) => {
    if (n.degree < 3) return;
    for (const [j] of network.adj[id]) {
      const m = network.nodes[j], len = Math.hypot(m.x - n.x, m.z - n.z), dx = (m.x - n.x) / len, dz = (m.z - n.z) / len;
      const edge = network.edges.find(e => (e.a === id && e.b === j) || (e.b === id && e.a === j));
      const along = n.w / 2 + 2.6, cw = { x: n.x + dx * along, z: n.z + dz * along, w: 3.4, d: edge.w - 1.5, rot: Math.atan2(-dz, dx), road: edge.w };
      if (junctions.some(o => o !== n && Math.hypot(o.x - cw.x, o.z - cw.z) < o.w / 2 + cw.d / 2 + 3)) continue;
      if (crosswalks.some(o => rectsOverlap(o, cw, 1))) continue;
      crosswalks.push(cw);
    }
  });
  // Street furniture along every edge, away from junctions.
  network.edges.forEach((e, i) => {
    const a = network.nodes[e.a], b = network.nodes[e.b], dx = (b.x - a.x) / e.length, dz = (b.z - a.z) / e.length;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (nearJunction(mx, mz, e.w / 2 + 10)) return;
    const side = i % 2 ? 1 : -1, off = e.w / 2 + 2.2, x = mx - dz * off * side, z = mz + dx * off * side;
    if (clearance(x, z) < 1.2) return;
    const coastal = e.kind === 'boulevard' || districtAt(x, z) === 'coast';
    if (coastal && i % 3 === 0) palms.push({ x, z, h: 8 + rand() * 4 });
    else if (e.w >= 14 && i % 4 === 1) lamps.push({ x, z, dir: Math.atan2(-dx * side, dz * side) });
  });
  // The player starts on the boulevard, pointed into downtown.
  let spawnNode = network.nodes[0], spawnScore = Infinity;
  network.nodes.forEach(n => { if (n.degree !== 2) return; const s = Math.hypot(n.x + 96, n.z - 112) + (nearJunction(n.x, n.z, 26) ? 100 : 0); if (s < spawnScore) { spawnScore = s; spawnNode = n; } });
  const spawnId = network.nodes.indexOf(spawnNode);
  const ahead = network.adj[spawnId].map(([j]) => network.nodes[j]).sort((p, q) => p.z - q.z)[0];
  const spawn = { x: spawnNode.x, z: spawnNode.z, yaw: Math.atan2(ahead.x - spawnNode.x, -(ahead.z - spawnNode.z)) };
  // Parked cars hug the kerb of wider streets.
  const colors = ['#d6b772', '#638c8a', '#b9b8a1', '#bc7765', '#829b9a', '#9c6b5c', '#c9c2a6'];
  for (let tries = 0; parked.length < 14 && tries < 400; tries++) {
    const e = network.edges[Math.floor(rand() * network.edges.length)];
    if (e.w < 14 || e.kind === 'ring' || e.length < 6) continue;
    const a = network.nodes[e.a], b = network.nodes[e.b], dx = (b.x - a.x) / e.length, dz = (b.z - a.z) / e.length, side = rand() < .5 ? -1 : 1;
    const x = (a.x + b.x) / 2 - dz * (e.w / 2 - 2) * side, z = (a.z + b.z) / 2 + dx * (e.w / 2 - 2) * side;
    if (nearJunction(x, z, e.w / 2 + 14) || Math.hypot(x - spawn.x, z - spawn.z) < 45 || parked.some(p => Math.hypot(p.x - x, p.z - z) < 40)) continue;
    parked.push({ x, z, w: 2.1, d: 4.5, rot: -Math.atan2(dx, -dz), color: colors[parked.length % colors.length] });
  }
  const obstacles = [...buildings.map(({ x, z, w, d, rot }) => ({ x, z, w, d, rot })), ...trees.map(({ x, z }) => ({ x, z, w: 1.4, d: 1.4, rot: 0 })), ...parked.map(({ x, z, w, d, rot }) => ({ x, z, w, d, rot }))];
  return { roads, network, buildings, trees, lamps, palms, parked, crosswalks, obstacles, spawn };
}
