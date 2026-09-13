import { LIMIT, clamp, angleDiff, blocked, lineOfSight, routeTo, resolveCollision } from './simulation.js';

export const MAX_LEVEL = 10;
const COUNTS = [2, 3, 4, 6, 7, 8, 9, 10, 11, 12];

// Every 30 seconds the wanted level rises. `skill` (0 → 1) scales how cleverly police drive.
export function difficulty(time) {
  const t = Math.max(0, time), level = Math.min(MAX_LEVEL, 1 + Math.floor(t / 30));
  const speed = level <= 5 ? 25 + level * 3 : 40 + (level - 5) * 2 + Math.min(4, Math.max(0, t - 300) / 60);
  return { level, count: COUNTS[level - 1], speed, skill: (level - 1) / (MAX_LEVEL - 1) };
}

// What each wanted level unlocks, so the HUD and announcements can describe it.
export const TACTICS = [
  { level: 1, name: '도주 차량 발견', unlock: '순찰차가 도로를 따라 추격합니다' },
  { level: 2, name: '지원 차량 출동', unlock: '경찰이 골목과 건물 사이까지 파고듭니다' },
  { level: 3, name: '도심 집중 추격', unlock: '경찰이 당신의 진행 방향을 예측합니다' },
  { level: 4, name: '긴급 수배 발령', unlock: '요격조가 앞길을 끊으러 돌아갑니다' },
  { level: 5, name: '광역 수배', unlock: '경찰의 코너링과 반응 속도가 빨라집니다' },
  { level: 6, name: '포위 작전', unlock: '가까워지면 사방에서 포위해 들어옵니다' },
  { level: 7, name: '특수 기동대 투입', unlock: '멀리 떨어진 순찰차가 전속력으로 복귀합니다' },
  { level: 8, name: '도시 봉쇄', unlock: '요격조가 늘고 더 멀리 앞질러 갑니다' },
  { level: 9, name: '전면 추격', unlock: '경찰이 거의 쉬지 않고 경로를 다시 계산합니다' },
  { level: 10, name: '최고 단계 · 퇴로 없음', unlock: '모든 전술이 최대치로 가동됩니다' },
];

// A flow field around the player: Dijkstra distances on a fine grid, so police can find a way
// into courtyards and narrow gaps that the road graph knows nothing about.
export function createNav(obstacles, { cell = 2, radius = 96, clearance = 1.15 } = {}) {
  const side = Math.round(radius * 2 / cell) + 1, world = Math.ceil(LIMIT / cell) * 2 + 1, cap = side * side * 4;
  return {
    obstacles, cell, radius, clearance, side, world, ready: false, gx0: 0, gz0: 0,
    dist: new Float32Array(side * side), open: new Uint8Array(side * side),
    // 0 = not sampled yet, 1 = open, 2 = blocked; filled lazily as the player explores the city.
    solid: new Uint8Array(world * world), heapKey: new Float32Array(cap), heapVal: new Int32Array(cap),
  };
}
function navBlocked(nav, gx, gz) {
  const half = (nav.world - 1) / 2, wx = gx + half, wz = gz + half;
  if (wx < 0 || wz < 0 || wx >= nav.world || wz >= nav.world) return true;
  const k = wz * nav.world + wx;
  if (!nav.solid[k]) nav.solid[k] = blocked(gx * nav.cell, gz * nav.cell, nav.obstacles, nav.clearance) || Math.abs(gx * nav.cell) > LIMIT - 1.5 || Math.abs(gz * nav.cell) > LIMIT - 1.5 ? 2 : 1;
  return nav.solid[k] === 2;
}
export function updateFlow(nav, target) {
  const { cell, side, dist, open, heapKey, heapVal } = nav, half = (side - 1) / 2;
  let cx = Math.round(target.x / cell), cz = Math.round(target.z / cell);
  nav.gx0 = cx - half; nav.gz0 = cz - half;
  for (let iz = 0, i = 0; iz < side; iz++) for (let ix = 0; ix < side; ix++, i++) open[i] = navBlocked(nav, ix + nav.gx0, iz + nav.gz0) ? 0 : 1;
  // The target may sit inside an inflated wall margin; start from the closest open cell instead.
  let seed = -1;
  for (let r = 0; r <= 3 && seed < 0; r++) for (let j = -r; j <= r && seed < 0; j++) for (let i = -r; i <= r; i++) if (open[(half + j) * side + half + i]) { seed = (half + j) * side + half + i; break; }
  dist.fill(Infinity);
  if (seed < 0) { nav.ready = false; return; }
  let size = 0;
  const push = (d, v) => { let k = size++; while (k > 0) { const q = (k - 1) >> 1; if (heapKey[q] <= d) break; heapKey[k] = heapKey[q]; heapVal[k] = heapVal[q]; k = q; } heapKey[k] = d; heapVal[k] = v; };
  dist[seed] = 0; push(0, seed);
  while (size) {
    const d = heapKey[0], u = heapVal[0], lastKey = heapKey[--size], lastVal = heapVal[size];
    let k = 0;
    for (;;) { let c = 2 * k + 1; if (c >= size) break; if (c + 1 < size && heapKey[c + 1] < heapKey[c]) c++; if (heapKey[c] >= lastKey) break; heapKey[k] = heapKey[c]; heapVal[k] = heapVal[c]; k = c; }
    heapKey[k] = lastKey; heapVal[k] = lastVal;
    if (d > dist[u]) continue;
    const ix = u % side, iz = (u - ix) / side;
    const l = ix > 0 && open[u - 1], r = ix < side - 1 && open[u + 1], t = iz > 0 && open[u - side], b = iz < side - 1 && open[u + side];
    const relax = (v, w) => { const nd = d + w; if (nd < dist[v] && size < heapKey.length) { dist[v] = nd; push(nd, v); } };
    if (l) relax(u - 1, 1); if (r) relax(u + 1, 1); if (t) relax(u - side, 1); if (b) relax(u + side, 1);
    // Diagonals only when both orthogonal cells are open: no squeezing past a wall corner.
    if (l && t && open[u - side - 1]) relax(u - side - 1, Math.SQRT2);
    if (r && t && open[u - side + 1]) relax(u - side + 1, Math.SQRT2);
    if (l && b && open[u + side - 1]) relax(u + side - 1, Math.SQRT2);
    if (r && b && open[u + side + 1]) relax(u + side + 1, Math.SQRT2);
  }
  nav.ready = true;
}
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
// Walk downhill through the flow field and return the farthest point that is still in plain sight.
export function flowWaypoint(nav, p, obstacles) {
  if (!nav.ready) return null;
  const { cell, side, dist } = nav;
  let ix = Math.round(p.x / cell) - nav.gx0, iz = Math.round(p.z / cell) - nav.gz0;
  if (ix < 1 || iz < 1 || ix >= side - 1 || iz >= side - 1) return null;
  let d = dist[iz * side + ix];
  if (!Number.isFinite(d)) {
    // Pressed against a wall: step onto the best open neighbour first.
    let best = Infinity, bx = ix, bz = iz;
    for (const [ox, oz] of NEIGHBOURS) { const v = dist[(iz + oz) * side + ix + ox]; if (v < best) { best = v; bx = ix + ox; bz = iz + oz; } }
    if (!Number.isFinite(best)) return null;
    ix = bx; iz = bz; d = best;
  }
  const points = [];
  for (let step = 0; step < 18 && d > 0; step++) {
    let best = d, bx = ix, bz = iz;
    for (const [ox, oz] of NEIGHBOURS) {
      const nx = ix + ox, nz = iz + oz;
      if (nx < 0 || nz < 0 || nx >= side || nz >= side) continue;
      const v = dist[nz * side + nx];
      if (v < best) { best = v; bx = nx; bz = nz; }
    }
    if (best >= d) break;
    ix = bx; iz = bz; d = best;
    points.push({ x: (ix + nav.gx0) * cell, z: (iz + nav.gz0) * cell });
  }
  if (!points.length) return null;
  for (let k = points.length - 1; k > 0; k--) if (lineOfSight(p, points[k], obstacles)) return points[k];
  return points[0];
}

// One brain drives the whole squad; it is pure logic so it can be simulated without rendering.
export function createPoliceBrain(city) {
  const { obstacles, network } = city, nav = createNav(obstacles);
  let flowTimer = 0;
  const inBounds = p => ({ x: clamp(p.x, -LIMIT + 7, LIMIT - 7), z: clamp(p.z, -LIMIT + 7, LIMIT - 7) });

  function tick(police, player, elapsed, dt) {
    const heat = difficulty(elapsed), { level, skill } = heat;
    // Level 1 sticks to roads; from level 2 the off-road flow field reaches further as heat rises.
    const flowReach = level >= 2 ? 34 + 58 * skill : 0;
    const nearest = police.reduce((m, c) => Math.min(m, Math.hypot(c.x - player.x, c.z - player.z)), Infinity);
    flowTimer -= dt;
    if (flowReach && nearest < flowReach + 10 && flowTimer <= 0) { updateFlow(nav, player); flowTimer = .45 - .25 * skill; }
    const turnRate = 2.1 + 1.5 * skill, grip = 2.2 + 1.8 * skill, repathEvery = 1 - .72 * skill;
    for (let i = 0; i < police.length; i++) {
      const c = police[i], dx = player.x - c.x, dz = player.z - c.z, dist = Math.hypot(dx, dz);
      // Choose what to aim at: the player, where the player is heading, a cut-off ahead, or a flanking slot.
      const lead = level >= 3 ? (.25 + 1.1 * skill) * Math.min(1, dist / 50) : .15;
      let aim = { x: player.x + player.vx * lead, z: player.z + player.vz * lead };
      c.role = 'chase';
      const interceptors = level >= 8 ? 2 : level >= 4 ? 1 : 0;
      if (interceptors && police.length > 2 && i % 4 < interceptors && i > 0 && dist > 40 && player.speed > 12) {
        const ahead = 2 + 2.5 * skill;
        aim = { x: player.x + player.vx * ahead, z: player.z + player.vz * ahead };
        c.role = 'intercept';
      } else if (level >= 6 && dist < 30 && police.length > 1) {
        const a = i / police.length * Math.PI * 2 + elapsed * .25, r = 4.5;
        const slot = { x: player.x + Math.cos(a) * r, z: player.z + Math.sin(a) * r };
        if (!blocked(slot.x, slot.z, obstacles, 1.2)) { aim = slot; c.role = 'surround'; }
      }
      aim = inBounds(aim);
      if (blocked(aim.x, aim.z, obstacles, 1.2)) aim = { x: player.x, z: player.z };

      c.repath -= dt;
      const reached = c.route.length && Math.hypot(c.route[0].x - c.x, c.route[0].z - c.z) < 4;
      if (c.repath <= 0 || (reached && c.route.length === 1)) {
        let route = null;
        if (flowReach && dist < flowReach && c.role !== 'intercept') {
          if (Math.hypot(aim.x - c.x, aim.z - c.z) < 110 && lineOfSight(c, aim, obstacles)) route = [aim];
          else { const wp = flowWaypoint(nav, c, obstacles); if (wp) route = [wp]; }
        }
        c.route = route || routeTo(c, aim, obstacles, network);
        c.repath = repathEvery + i * .02;
      }
      while (c.route.length > 1 && Math.hypot(c.route[0].x - c.x, c.route[0].z - c.z) < 7) c.route.shift();

      const target = c.route[0] || aim, desired = Math.atan2(target.x - c.x, -(target.z - c.z)), turn = angleDiff(desired, c.yaw);
      let targetSpeed;
      if (c.reverse > 0) {
        // Back out of a wall while swinging the nose towards the goal.
        c.reverse -= dt; c.yaw += clamp(turn, -turnRate * dt, turnRate * dt); targetSpeed = -9;
      } else {
        c.yaw += clamp(turn, -turnRate * dt, turnRate * dt);
        const hard = .26 + .22 * skill, soft = .62 + .2 * skill, abs = Math.abs(turn);
        targetSpeed = heat.speed * (abs > 1 ? hard : abs > .45 ? soft : 1);
        if (level >= 7 && dist > 140) targetSpeed *= 1.25;
        // Ease off when threading the last few metres so they don't overshoot into walls.
        const toTarget = Math.hypot(target.x - c.x, target.z - c.z);
        if (c.route.length === 1 && toTarget < 14) targetSpeed = Math.min(targetSpeed, 9 + toTarget * 1.6 + player.speed);
      }
      c.speed += (targetSpeed - c.speed) * Math.min(1, dt * grip);
      c.vx = Math.sin(c.yaw) * c.speed; c.vz = -Math.cos(c.yaw) * c.speed;
      const oldX = c.x, oldZ = c.z; c.x += c.vx * dt; c.z += c.vz * dt;
      if (resolveCollision(c, obstacles)) { c.speed *= .8; if (c.repath > .15) c.repath = .15; }
      const moved = Math.hypot(c.x - oldX, c.z - oldZ);
      c.stuck = moved < dt * 1.5 ? (c.stuck || 0) + dt : 0;
      if (c.stuck > 1.4 - .8 * skill && !(c.reverse > 0)) { c.reverse = .7; c.stuck = 0; c.repath = 0; }

      // Bumping: police shove the player, and cruisers keep a little space between each other.
      if (dist < 3.6 && dist > .001) { const force = 3.6 - dist; player.x += dx / dist * force * .55; player.z += dz / dist * force * .55; c.x -= dx / dist * force * .45; c.z -= dz / dist * force * .45; player.vx *= .982; player.vz *= .982; }
      for (let j = 0; j < i; j++) { const o = police[j], ox = c.x - o.x, oz = c.z - o.z, d = Math.hypot(ox, oz); if (d < 3.5 && d > .01) { c.x += ox / d * (3.5 - d) * .5; c.z += oz / d * (3.5 - d) * .5; } }
      resolveCollision(c, obstacles);
    }
    resolveCollision(player, obstacles);
  }
  return { tick, nav };
}
