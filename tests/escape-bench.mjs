// Headless benchmark: a fleeing bot drives the road graph away from police. How long does it survive per level?
import { createCity } from '../src/city.js';
import { createPoliceBrain, difficulty } from '../src/police.js';
import { updatePlayer, updateCapture, createPlayer, angleDiff } from '../src/simulation.js';

const city = createCity(), { obstacles, network } = city;
let seed = 5; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function survive(level, startNode) {
  const brain = createPoliceBrain(city), elapsed0 = (level - 1) * 30 + .5, heat = difficulty(elapsed0);
  const s = network.nodes[startNode], player = createPlayer({ x: s.x, z: s.z, yaw: 0 });
  const near = network.nodes.filter(n => { const d = Math.hypot(n.x - s.x, n.z - s.z); return d > 90 && d < 140; });
  const police = Array.from({ length: heat.count }, (_, i) => { const n = near[Math.floor(i * near.length / heat.count)]; return { x: n.x, z: n.z, yaw: 0, vx: 0, vz: 0, speed: 0, route: [], repath: 0, stuck: 0 }; });
  let node = startNode, prev = -1, dt = 1 / 90;
  for (let t = 0; t < 120; t += dt) {
    const here = network.nodes[node];
    if (Math.hypot(here.x - player.x, here.z - player.z) < 6) {
      // Pick the next node (a few hops ahead) that keeps police furthest away.
      let best = -1, score = -Infinity;
      for (const [j] of network.adj[node]) {
        if (j === prev && network.adj[node].length > 1) continue;
        let k = j, p = node; for (let h = 0; h < 4; h++) { const nx = network.adj[k].find(([q]) => q !== p); if (!nx) break; p = k; k = nx[0]; }
        const q = network.nodes[k], danger = Math.min(...police.map(c => Math.hypot(c.x - q.x, c.z - q.z)));
        if (danger + rand() * 4 > score) { score = danger; best = j; }
      }
      prev = node; node = best;
    }
    const target = network.nodes[node], turn = angleDiff(Math.atan2(target.x - player.x, -(target.z - player.z)), player.yaw);
    updatePlayer(player, { up: Math.abs(turn) < 1.2 || player.speed < 12, down: Math.abs(turn) > 1.2 && player.speed > 20, left: turn < -.06, right: turn > .06, boost: Math.abs(turn) < .2 && player.nitro > .3 }, dt, obstacles);
    brain.tick(police, player, elapsed0 + t, dt);
    if (updateCapture(player, police, dt, level, obstacles)) return t;
  }
  return 120;
}
const starts = Array.from({ length: 10 }, () => Math.floor(rand() * network.nodes.length));
for (const level of [1, 3, 5, 7, 10]) {
  const times = starts.map(n => survive(level, n)).sort((a, b) => a - b);
  console.log(`L${String(level).padStart(2)}: median survival ${times[5].toFixed(1)}s  (min ${times[0].toFixed(1)}s, survived full 120s: ${times.filter(t => t >= 120).length}/10)`);
}
