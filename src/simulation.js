export const LIMIT = 372;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export function formatTime(seconds) {
  const ms = Math.max(0, Math.floor((Number(seconds) || 0) * 1000));
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}<small>.${String(ms % 1000).padStart(3, '0')}</small>`;
}
export function createPlayer(spawn = { x: 4, z: 72, yaw: 0 }) { return { x: spawn.x, z: spawn.z, yaw: spawn.yaw, vx: 0, vz: 0, speed: 0, nitro: 1, capture: 0, drifting: false, boosting: false }; }

// Obstacles may be rotated (three.js rotation.y convention); a lazily built spatial hash keeps lookups cheap on a large map.
const CELL = 24, MARGIN = 2.5, EMPTY = [], indexes = new WeakMap();
function nearby(obstacles, x, z) {
  let index = indexes.get(obstacles);
  if (!index || index.count !== obstacles.length) {
    const cells = new Map();
    for (const b of obstacles) {
      b.c = Math.cos(b.rot || 0); b.s = Math.sin(b.rot || 0);
      const reach = Math.hypot(b.w, b.d) / 2 + MARGIN;
      for (let cx = Math.floor((b.x - reach) / CELL); cx <= Math.floor((b.x + reach) / CELL); cx++)
        for (let cz = Math.floor((b.z - reach) / CELL); cz <= Math.floor((b.z + reach) / CELL); cz++) {
          const k = (cx + 512) * 1024 + cz + 512; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(b);
        }
    }
    index = { count: obstacles.length, cells }; indexes.set(obstacles, index);
  }
  return index.cells.get((Math.floor(x / CELL) + 512) * 1024 + Math.floor(z / CELL) + 512) || EMPTY;
}
export function blocked(x, z, obstacles, radius = 1.25) {
  return nearby(obstacles, x, z).some(b => {
    const dx = x - b.x, dz = z - b.z;
    return Math.abs(dx * b.c - dz * b.s) < b.w / 2 + radius && Math.abs(dx * b.s + dz * b.c) < b.d / 2 + radius;
  });
}
export function lineOfSight(a, b, obstacles, radius = 1.7) {
  const dist = Math.hypot(a.x - b.x, a.z - b.z), steps = Math.ceil(dist / Math.min(2.5, radius + .8));
  for (let i = 1; i <= steps; i++) { const t = i / steps; if (blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, obstacles, radius)) return false; }
  return true;
}
// Cars collide as three circles along their length, so the long nose and tail stay out of walls.
// Contacts push out along the surface normal and only cancel the velocity heading into the wall,
// letting the car slide along facades and round corners instead of sticking.
const CAR_RADIUS = 1.2, CAR_CIRCLES = [-1.7, 0, 1.7];
export function resolveCollision(body, obstacles) {
  let hit = false;
  const offsets = Number.isFinite(body.yaw) ? CAR_CIRCLES : [0];
  for (let pass = 0; pass < 2; pass++) for (const offset of offsets) {
    const fx = offsets.length > 1 ? Math.sin(body.yaw) * offset : 0, fz = offsets.length > 1 ? -Math.cos(body.yaw) * offset : 0;
    const r = offsets.length > 1 ? CAR_RADIUS : 1.25;
    for (const b of nearby(obstacles, body.x + fx, body.z + fz)) {
      const dx = body.x + fx - b.x, dz = body.z + fz - b.z;
      const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c, hw = b.w / 2, hd = b.d / 2;
      const cx = clamp(lx, -hw, hw), cz = clamp(lz, -hd, hd);
      let nx, nz, depth;
      if (cx !== lx || cz !== lz) {
        const ox = lx - cx, oz = lz - cz, dist = Math.hypot(ox, oz);
        if (dist >= r) continue;
        nx = ox / dist; nz = oz / dist; depth = r - dist;
      } else {
        // Centre inside the box (very fast impact): leave through the nearest face.
        const px = hw - Math.abs(lx), pz = hd - Math.abs(lz);
        if (px < pz) { nx = lx >= 0 ? 1 : -1; nz = 0; depth = px + r; } else { nx = 0; nz = lz >= 0 ? 1 : -1; depth = pz + r; }
      }
      hit = true;
      const wx = nx * b.c + nz * b.s, wz = -nx * b.s + nz * b.c;
      body.x += wx * (depth + .001); body.z += wz * (depth + .001);
      const into = body.vx * wx + body.vz * wz;
      if (into < 0) { body.vx -= wx * into * 1.12; body.vz -= wz * into * 1.12; body.vx *= .985; body.vz *= .985; }
      if (offsets.length > 1) {
        // Glancing contact turns the nose along the wall so a scrape becomes a slide, not a stop.
        const hx = Math.sin(body.yaw), hz = -Math.cos(body.yaw), facing = hx * wx + hz * wz;
        if (facing < -.05 && facing > -.8) {
          const tx = hx - wx * facing, tz = hz - wz * facing;
          body.yaw += angleDiff(Math.atan2(tx, -tz), body.yaw) * .18;
        }
      }
    }
  }
  if (Math.abs(body.x) > LIMIT) { body.x = clamp(body.x, -LIMIT, LIMIT); body.vx *= -.35; hit = true; }
  if (Math.abs(body.z) > LIMIT) { body.z = clamp(body.z, -LIMIT, LIMIT); body.vz *= -.35; hit = true; }
  return hit;
}
export function updatePlayer(p, input, dt, obstacles) {
  const forward = +!!input.up - +!!input.down;
  const signedSpeed = p.vx * Math.sin(p.yaw) - p.vz * Math.cos(p.yaw);
  p.drifting = !!input.drift && Math.abs(signedSpeed) > 7;
  p.boosting = !!input.boost && input.up && p.nitro > .015;
  p.nitro = clamp(p.nitro + (p.boosting ? -.24 : .105) * dt, 0, 1);
  const steer = +!!input.right - +!!input.left;
  // A little steering while throttling from standstill lets the car pivot away from a wall it is pressed against.
  const reversing = signedSpeed < -1 || (Math.abs(signedSpeed) <= 1 && forward < 0);
  const steerFactor = Math.max(Math.min(1, Math.abs(signedSpeed) / 7), forward ? .45 : 0) * (reversing ? -1 : 1);
  p.yaw += steer * steerFactor * (p.drifting ? 1.85 : 1.22) * dt;
  const sx = Math.sin(p.yaw), sz = -Math.cos(p.yaw);
  const acceleration = forward < 0 && signedSpeed > 1 ? 34 : p.boosting ? 38 : 22;
  p.vx += sx * forward * acceleration * dt; p.vz += sz * forward * acceleration * dt;
  const long = p.vx * sx + p.vz * sz;
  const lateralX = p.vx - sx * long, lateralZ = p.vz - sz * long;
  const grip = Math.min(1, (p.drifting ? 1.6 : 8) * dt);
  p.vx -= lateralX * grip; p.vz -= lateralZ * grip;
  const drag = Math.exp(-(forward ? .46 : 1.0) * dt);
  p.vx *= drag; p.vz *= drag;
  const speed = Math.hypot(p.vx, p.vz), maxSpeed = long < 0 ? 13 : p.boosting ? 65 : 44;
  if (speed > maxSpeed) { p.vx *= maxSpeed / speed; p.vz *= maxSpeed / speed; }
  p.x += p.vx * dt; p.z += p.vz * dt;
  const hit = resolveCollision(p, obstacles);
  p.speed = Math.hypot(p.vx, p.vz);
  return hit;
}

function nearestNode(network, p, obstacles) {
  const close = [];
  let fallback = 0, fallbackDist = Infinity;
  network.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - p.x, n.z - p.z);
    if (d < fallbackDist) { fallbackDist = d; fallback = i; }
    if (d < 45) close.push([d, i]);
  });
  close.sort((a, b) => a[0] - b[0]);
  for (const [, i] of close.slice(0, 8)) if (lineOfSight(p, network.nodes[i], obstacles)) return i;
  return fallback;
}
export function shortestPath(network, start, end) {
  const n = network.nodes.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), heap = [];
  const push = item => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= item[0]) break; heap[i] = heap[p]; i = p; } heap[i] = item; };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= last[0]) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return top; };
  dist[start] = 0; push([0, start]);
  while (heap.length) {
    const [d, u] = pop();
    if (u === end) break;
    if (d > dist[u]) continue;
    for (const [v, w] of network.adj[u]) if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; push([d + w, v]); }
  }
  const path = [];
  for (let u = end; u !== -1; u = prev[u]) path.push(u);
  return path.at(-1) === start ? path.reverse() : [start];
}
// Police chase directly when they can see the target, otherwise follow the road graph.
export function routeTo(from, target, obstacles, network) {
  if (Math.hypot(target.x - from.x, target.z - from.z) < 110 && lineOfSight(from, target, obstacles)) return [{ x: target.x, z: target.z }];
  if (!network?.nodes.length) return [{ x: target.x, z: target.z }];
  const path = shortestPath(network, nearestNode(network, from, obstacles), nearestNode(network, target, obstacles)).map(i => ({ x: network.nodes[i].x, z: network.nodes[i].z }));
  const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  while (path.length > 1 && d(from, path[1]) < d(path[0], path[1])) path.shift();
  path.push({ x: target.x, z: target.z });
  return path;
}
// Higher wanted levels fill the arrest meter faster and let it drain more slowly.
// Only cruisers with a clear line to the player count, so a wall between you and the police is real cover.
export function updateCapture(p, police, dt, level = 1, obstacles = null) {
  const close = police.filter(c => Math.hypot(c.x - p.x, c.z - p.z) < 7.5 && (!obstacles || lineOfSight(c, p, obstacles, .3))).length, heat = 1 + (level - 1) * .06;
  p.capture = clamp(p.capture + (close ? (.19 + close * .065) * (p.speed < 10 ? 1.65 : .65) * heat : -.24 / heat) * dt, 0, 1);
  return p.capture >= 1;
}
export function saveRecord(records, time, date = new Date().toISOString()) {
  return [...records, { time, date }].filter(r => Number.isFinite(r.time) && r.time >= 0 && typeof r.date === 'string').sort((a, b) => b.time - a.time).slice(0, 10);
}
