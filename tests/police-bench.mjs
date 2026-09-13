// Headless benchmark: how quickly do police arrest a player hiding between buildings?
import { createCity } from '../src/city.js';
import { createPoliceBrain, difficulty } from '../src/police.js';
import { routeTo, resolveCollision, clamp, angleDiff, blocked, updateCapture, LIMIT } from '../src/simulation.js';

const city = createCity(), { obstacles, network } = city;
function legacyTick(police, player, elapsed, dt) {
  const level = { speed: Math.min(5, 1 + Math.floor(elapsed / 30)) * 3 + 25 };
  for (let i = 0; i < police.length; i++) {
    const c = police[i]; c.repath -= dt;
    if (c.repath <= 0) { c.route = routeTo(c, { x: clamp(player.x + player.vx * .6, -LIMIT + 7, LIMIT - 7), z: clamp(player.z + player.vz * .6, -LIMIT + 7, LIMIT - 7) }, obstacles, network); c.repath = .8 + i * .03; }
    while (c.route.length > 1 && Math.hypot(c.route[0].x - c.x, c.route[0].z - c.z) < 7) c.route.shift();
    const target = c.route[0] || player, desired = Math.atan2(target.x - c.x, -(target.z - c.z)), turn = angleDiff(desired, c.yaw);
    c.yaw += clamp(turn, -2.1 * dt, 2.1 * dt);
    const targetSpeed = level.speed * (Math.abs(turn) > 1 ? .26 : Math.abs(turn) > .45 ? .62 : 1);
    c.speed += (targetSpeed - c.speed) * Math.min(1, dt * 2.2);
    c.vx = Math.sin(c.yaw) * c.speed; c.vz = -Math.cos(c.yaw) * c.speed;
    const ox = c.x, oz = c.z; c.x += c.vx * dt; c.z += c.vz * dt;
    if (resolveCollision(c, obstacles)) { c.speed *= .65; c.repath = 0; }
    c.stuck = Math.hypot(c.x - ox, c.z - oz) < dt * 1.5 ? c.stuck + dt : 0;
    if (c.stuck > 2) { c.yaw += Math.PI * .75; c.speed = 9; c.stuck = 0; c.repath = 0; }
  }
}
// Hiding spots: open ground well away from any road, hemmed in by at least three buildings.
const TIGHT = process.argv.includes("--tight");
let ticks = 0;
let seed = 11; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const spots = [];
while (spots.length < 12) {
  const x = (rand() - .5) * 680, z = (rand() - .5) * 680;
  if (blocked(x, z, obstacles, TIGHT ? 1.4 : 2.2) || (TIGHT && !blocked(x, z, obstacles, 3.4))) continue;
  const roadGap = Math.min(...network.nodes.map(n => Math.hypot(n.x - x, n.z - z) - n.w / 2));
  const walls = city.buildings.filter(b => Math.hypot(b.x - x, b.z - z) < 22).length;
  if (roadGap > (TIGHT ? 8 : 14) && walls >= (TIGHT ? 2 : 3)) spots.push({ x, z });
}
function run(brain, level, spot) {
  const elapsed0 = (level - 1) * 30 + 1, player = { ...spot, yaw: 0, vx: 0, vz: 0, speed: 0, capture: 0 };
  const count = brain.legacy ? Math.min(8, Math.min(5, level) + 1 + Math.floor(Math.min(5, level) / 4)) : difficulty(elapsed0).count;
  const nodes = network.nodes.filter(n => { const d = Math.hypot(n.x - spot.x, n.z - spot.z); return d > 80 && d < 130; });
  const police = Array.from({ length: count }, (_, i) => { const n = nodes[Math.floor(i * nodes.length / count)]; return { x: n.x, z: n.z, yaw: 0, vx: 0, vz: 0, speed: 0, route: [], repath: 0, stuck: 0 }; });
  const dt = 1 / 90;
  for (let t = 0; t < 90; t += dt) {
    ticks++; brain.tick(police, player, elapsed0 + t, dt); player.vx = player.vz = 0;
    if (updateCapture(player, police, dt, brain.legacy ? Math.min(5, level) : difficulty(elapsed0 + t).level, obstacles)) return t;
  }
  return Infinity;
}
const police_count = (level, brain) => brain.legacy ? Math.min(8, Math.min(5, level) + 1 + Math.floor(Math.min(5, level) / 4)) : difficulty((level - 1) * 30 + 1).count;
const legacy = { legacy: true, tick: legacyTick }, smart = createPoliceBrain(city);
for (const level of [1, 2, 5, 10]) {
  for (const [name, brain] of [['old', legacy], ['new', smart]]) {
    if (name === 'old' && level === 10) continue;
    ticks = 0; const t0 = performance.now(), times = spots.map(s => run(brain, level, s)), ms = performance.now() - t0;
    const caught = times.filter(Number.isFinite), median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
    console.log(`L${String(level).padStart(2)} ${name}: caught ${caught.length}/${spots.length}, median ${Number.isFinite(median) ? median.toFixed(1) + 's' : 'never'}  (${(ms / ticks).toFixed(3)}ms per tick, ${police_count(level, brain)} cars)`);
  }
}
