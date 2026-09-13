import * as THREE from 'three';
import { LIMIT } from './simulation.js';
import { createCity } from './city.js';

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f29a69');
  scene.fog = new THREE.FogExp2('#e79b79', .0024);
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, .2, 1900);
  const ambient = new THREE.HemisphereLight('#ffdab0', '#617c79', 2.5); scene.add(ambient);
  // The shadow frustum follows the action, so the whole city can cast shadows without a huge shadow map.
  const SUN_OFFSET = new THREE.Vector3(-100, 105, -140);
  const sun = new THREE.DirectionalLight('#ffb574', 3.9); sun.position.copy(SUN_OFFSET); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 1, far: 440 });
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .04; scene.add(sun); scene.add(sun.target);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#849d9c') }, middle: { value: new THREE.Color('#f39876') }, bottom: { value: new THREE.Color('#fbc18b') } },
    vertexShader: 'varying vec3 vPosition; void main(){ vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 middle; uniform vec3 bottom; varying vec3 vPosition; void main(){float h=normalize(vPosition).y;vec3 c=mix(bottom,middle,smoothstep(-.05,.3,h));c=mix(c,top,smoothstep(.22,.9,h));gl_FragColor=vec4(c,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'
  })); scene.add(sky);
  const SUN_DISC = new THREE.Vector3(-700, 330, -900);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(75, 64), new THREE.MeshBasicMaterial({ color: '#ffe3a3', fog: false }));
  sunDisc.position.copy(SUN_DISC); sunDisc.lookAt(0, 0, 0); scene.add(sunDisc);

  const unitBox = new THREE.BoxGeometry(1, 1, 1), disc = new THREE.CylinderGeometry(1, 1, 1, 20), buckets = new Map(), dummy = new THREE.Object3D();
  const roofGeo = new THREE.ConeGeometry(1, 1, 4); roofGeo.rotateY(Math.PI / 4);
  const mats = new Map();
  const material = (color, emissive = false) => { const key = color + emissive; if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: .88, metalness: 0, ...(emissive ? { emissive: color, emissiveIntensity: .5 } : {}) })); return mats.get(key); };
  function instance(geom, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, shadow = true) {
    const key = geom.uuid + mat.uuid + shadow; if (!buckets.has(key)) buckets.set(key, { geom, mat, shadow, transforms: [] });
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(rx, ry, rz); dummy.updateMatrix();
    buckets.get(key).transforms.push(dummy.matrix.clone());
  }
  const box = (x, y, z, w, h, d, color, ry = 0) => instance(unitBox, material(color), x, y, z, w, h, d, 0, ry);
  const flat = (x, y, z, w, h, d, color, ry = 0) => instance(unitBox, material(color), x, y, z, w, h, d, 0, ry, 0, false);
  // Place a box in a rotated local frame (lx along the building's x axis, lz along its z axis).
  const local = (b, lx, lz) => [b.x + lx * Math.cos(b.rot) + lz * Math.sin(b.rot), b.z - lx * Math.sin(b.rot) + lz * Math.cos(b.rot)];
  let seed = 311;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  const city = createCity();
  const { network } = city;
  const SIZE = LIMIT * 2 + 30;
  // Ground, beach and the bay to the west.
  box(0, -.55, 0, SIZE, 1, SIZE, '#7c8b79');
  box(0, -1.2, 0, 2600, 1, 2600, '#8a9483');
  box(-LIMIT - 24, -.5, 0, 34, 1, SIZE, '#d8c29a');
  box(-LIMIT - 540, -1.05, 0, 1000, .3, 2600, '#649b98');
  for (let i = 0; i < 160; i++) flat(-LIMIT - 60 - rand() * 500, -.88, -900 + rand() * 1800, 3 + rand() * 22, .01, .15, '#9fbab0');
  for (const n of [-LIMIT - 4, LIMIT + 4]) { box(n, .6, 0, .8, 1.2, SIZE - 20, '#b7af95'); box(0, .6, n, SIZE - 20, 1.2, .8, '#b7af95'); }
  for (let z = -LIMIT + 10; z < LIMIT; z += 16) box(-LIMIT - 4, 1.6, z, .3, 2, .3, '#d1c9b1');
  box(-LIMIT - 4, 2.55, 0, .2, .18, SIZE - 20, '#c8c7b1');

  // Roads: every graph edge is a rotated slab, every node a disc so bends and junctions join cleanly.
  const ROAD = '#424e51', KERB = '#b3ae9c', LINE = '#d7b982', EDGE_LINE = '#bdc0b0';
  const junctions = network.nodes.filter(n => n.degree >= 3);
  const nearJunction = (x, z, r) => junctions.some(n => Math.abs(n.x - x) < r && Math.abs(n.z - z) < r && Math.hypot(n.x - x, n.z - z) < r);
  for (const e of network.edges) {
    const a = network.nodes[e.a], b = network.nodes[e.b], dx = (b.x - a.x) / e.length, dz = (b.z - a.z) / e.length;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, rot = Math.atan2(-dz, dx);
    flat(mx, .04, mz, e.length, .08, e.w + 6, KERB, rot);
    flat(mx, .05, mz, e.length, .1, e.w, ROAD, rot);
    if (nearJunction(mx, mz, e.w / 2 + 9)) continue;
    const across = (off, len, width, color) => flat(mx - dz * off, .106, mz + dx * off, len, .012, width, color, rot);
    if (e.w >= 18) { across(-.3, e.length * .55, .14, LINE); across(.3, e.length * .55, .14, LINE); }
    else across(0, e.length * .45, .14, LINE);
    across(e.w / 2 - 1.1, e.length + .2, .12, EDGE_LINE); across(-e.w / 2 + 1.1, e.length + .2, .12, EDGE_LINE);
  }
  for (const n of network.nodes) {
    instance(disc, material(KERB), n.x, .04, n.z, n.w / 2 + 3, .08, n.w / 2 + 3, 0, 0, 0, false);
    instance(disc, material(ROAD), n.x, .05, n.z, n.w / 2, .1, n.w / 2, 0, 0, 0, false);
  }
  // Zebra crossings (placement and overlap checks live in city.js).
  for (const cw of city.crosswalks) {
    const px = Math.cos(cw.rot), pz = -Math.sin(cw.rot), sx = pz, sz = -px;
    for (let k = -cw.d / 2 + .6; k <= cw.d / 2 - .6; k += 2.3) flat(cw.x + sx * k, .108, cw.z + sz * k, 2.6, .012, 1.1, '#d9d5bb', cw.rot);
  }
  // Buildings with district-specific shapes: glassy towers, flat-roofed warehouses, pitched-roof houses.
  const palettes = {
    downtown: ['#81958b', '#67827f', '#a9a191', '#8e9a93', '#b9afa0', '#6f7f7c'],
    industrial: ['#9a9a8c', '#8c958d', '#a58d7a', '#7f8b86'],
    coast: ['#e2c9a6', '#d99b82', '#bfd0c1', '#e8d7b5', '#c5a486'],
    hills: ['#e6d6b8', '#d7b49a', '#c9cbb2', '#efe0c4'],
    suburb: ['#c5a486', '#bbb9a5', '#d6c1a1', '#a97865', '#c09b88'],
  };
  const roofs = ['#a8604c', '#8f5b4d', '#b67a5d', '#6f6a63'];
  for (const b of city.buildings) {
    const pal = palettes[b.district], color = pal[Math.floor(b.tone * pal.length)];
    box(b.x, b.h / 2 + .1, b.z, b.w, b.h, b.d, color, b.rot);
    const house = b.district === 'hills' || b.district === 'suburb';
    if (house) {
      instance(roofGeo, material(roofs[Math.floor(b.tone * 13) % roofs.length]), b.x, b.h + 1.6, b.z, (b.w + 1) * .7071, 3.2, (b.d + 1) * .7071, 0, b.rot);
      for (const side of [-1, 1]) {
        const [wx, wz] = local(b, side * b.w / 4, b.d / 2 + .03); box(wx, b.h * .55, wz, 1.6, 1.5, .06, '#516e70', b.rot);
        const [bx, bz] = local(b, side * b.w / 4, -b.d / 2 - .03); box(bx, b.h * .55, bz, 1.6, 1.5, .06, '#516e70', b.rot);
      }
      const [dx, dz] = local(b, 0, b.d / 2 + .04); box(dx, 1.2, dz, 1.3, 2.2, .08, '#6b5244', b.rot);
      continue;
    }
    box(b.x, b.h + .35, b.z, b.w + .5, .5, b.d + .5, b.district === 'industrial' ? '#6f7671' : '#d0c4aa', b.rot);
    if (b.district === 'industrial') {
      for (let k = -b.w / 2 + 3; k < b.w / 2 - 2; k += 6) { const [dx, dz] = local(b, k, b.d / 2 + .04); box(dx, 2.6, dz, 4, 4.6, .1, '#56625f', b.rot); }
      const [sx, sz] = local(b, b.w / 4, -b.d / 4); if (b.tone > .6) box(sx, b.h + 5, sz, 1.4, 10, 1.4, '#8a8a80', b.rot);
      continue;
    }
    const [ux, uz] = local(b, -b.w * .15, b.d * .1); box(ux, b.h + 1.2, uz, b.w * .5, 1.2, b.d * .5, '#8b9185', b.rot);
    if (b.h < 20) { const [ax, az] = local(b, 0, b.d / 2 + .7); box(ax, 2.6, az, b.w * .75, .18, 1.4, '#bd795d', b.rot); }
    const step = b.district === 'downtown' ? 4 : 3.6;
    for (let y = 3.5; y < b.h - 1; y += step) {
      for (let k = -b.w / 2 + 2.4; k <= b.w / 2 - 2.4; k += 3.6) for (const side of [-1, 1]) {
        const lit = rand() > .82 ? '#e6c185' : '#516e70', [wx, wz] = local(b, k, side * (b.d / 2 + .02));
        box(wx, y, wz, 1.6, 1.9, .05, lit, b.rot);
      }
      for (let k = -b.d / 2 + 2.4; k <= b.d / 2 - 2.4; k += 3.6) for (const side of [-1, 1]) {
        const lit = rand() > .82 ? '#e6c185' : '#516e70', [wx, wz] = local(b, side * (b.w / 2 + .02), k);
        box(wx, y, wz, .05, 1.9, 1.6, lit, b.rot);
      }
    }
  }

  // Vegetation and street furniture.
  const trunkGeo = new THREE.CylinderGeometry(.22, .4, 1, 5), leafGeo = new THREE.ConeGeometry(1, 1, 3), foliageGeo = new THREE.IcosahedronGeometry(1, 0), pineGeo = new THREE.ConeGeometry(1, 1, 6);
  for (const t of city.trees) {
    if (t.pine) { instance(trunkGeo, material('#6f624e'), t.x, 1, t.z, t.scale, 2, t.scale); instance(pineGeo, material(t.scale > 1.1 ? '#4f6d58' : '#5b7a5f'), t.x, 2 + 3.2 * t.scale, t.z, 2.2 * t.scale, 6.4 * t.scale, 2.2 * t.scale); }
    else { instance(trunkGeo, material('#736952'), t.x, 1.7 * t.scale, t.z, t.scale, 3.4 * t.scale, t.scale); instance(foliageGeo, material(t.scale > 1.1 ? '#6d8862' : '#7a9166'), t.x, 4.5 * t.scale, t.z, 2.8 * t.scale, 3.2 * t.scale, 2.8 * t.scale); }
  }
  function palm(x, z, height = 9) {
    instance(trunkGeo, material('#8b7962'), x, height / 2, z, 1, height, 1, 0, 0, -.07);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; instance(leafGeo, material(i % 2 ? '#587963' : '#426b5b'), x + Math.cos(a) * 1.9, height - .25, z + Math.sin(a) * 1.9, 1.25, 5.3, .6, Math.cos(a) * 1.1, a, Math.sin(a) * 1.1); }
    instance(foliageGeo, material('#527960'), x, height - .1, z, .8, .7, .8);
  }
  for (const p of city.palms) palm(p.x, p.z, p.h);
  for (let z = -LIMIT + 14; z < LIMIT; z += 26) palm(-LIMIT - 14, z, 9 + rand() * 3);
  function lamp(x, z, dir = 0) {
    box(x, 3.9, z, .17, 7.8, .17, '#435854');
    box(x + Math.cos(dir) * .7, 7.75, z + Math.sin(dir) * .7, 1.7, .16, .22, '#435854', -dir);
    instance(unitBox, material('#ffe0a5', true), x + Math.cos(dir) * 1.4, 7.65, z + Math.sin(dir) * 1.4, .65, .13, .35, 0, -dir);
  }
  for (const l of city.lamps) lamp(l.x, l.z, l.dir);

  // Beyond the playable city: a hazy skyline to the north and faceted hills around the rest.
  for (let i = 0; i < 70; i++) {
    const x = -300 + rand() * 900, z = -LIMIT - 60 - rand() * 220, h = 25 + rand() * 110, w = 14 + rand() * 26;
    box(x, h / 2 - 1, z, w, h, 15 + rand() * 20, i % 3 ? '#9f958d' : '#a49e92');
  }
  const mountainGeo = new THREE.ConeGeometry(1, 1, 5);
  for (let i = 0; i < 30; i++) {
    const a = -Math.PI * .45 + i / 29 * Math.PI * 1.4, r = 620 + rand() * 120;
    instance(mountainGeo, material(i % 2 ? '#b4978e' : '#a98f88'), Math.sin(a) * r + 80, 20, -Math.cos(a) * r, 90 + rand() * 80, 80 + rand() * 120, 100, 0, rand() * 3);
  }

  // Roadside district sign spanning the road just ahead of the start.
  const signCanvas = document.createElement('canvas'); signCanvas.width = 512; signCanvas.height = 192;
  const ctx = signCanvas.getContext('2d'); ctx.fillStyle = '#285154'; ctx.fillRect(0, 0, 512, 192); ctx.strokeStyle = '#d5d9b8'; ctx.lineWidth = 6; ctx.strokeRect(10, 10, 492, 172); ctx.fillStyle = '#f9ebc9'; ctx.font = 'bold 48px sans-serif'; ctx.fillText('GOLDEN BAY', 35, 78); ctx.font = '25px sans-serif'; ctx.fillText('DOWNTOWN    ↑', 38, 139);
  {
    const { spawn } = city, fx = Math.sin(spawn.yaw), fz = -Math.cos(spawn.yaw), rx = -fz, rz = fx, ahead = 48;
    const sx = spawn.x + fx * ahead, sz = spawn.z + fz * ahead, rot = -spawn.yaw;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(12, 4.5, .2), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(signCanvas), roughness: 1 }));
    sign.position.set(sx, 12, sz); sign.rotation.y = rot; scene.add(sign);
    for (const side of [-1, 1]) box(sx + rx * 13 * side, 6, sz + rz * 13 * side, .3, 12, .3, '#5e7069');
    box(sx, 12, sz, 26.5, .25, .25, '#5e7069', rot);
  }
  for (const { geom, mat, shadow, transforms } of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geom, mat, transforms.length);
    transforms.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.computeBoundingSphere(); scene.add(mesh);
  }
  function createCar(police=false,color='#f07438') {
    const car=new THREE.Group(); const wheels=[]; const bodyMat=material(police?'#d8ddd1':color), dark=material('#263b3e'), glass=material('#34585e');
    function part(w,h,d,x,y,z,mat) {const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;car.add(m);return m;}
    part(2.1,.55,4.5,0,.85,0,bodyMat);part(2.03,.34,4.2,0,1.22,-.04,bodyMat);
    const cabinGeo=new THREE.BufferGeometry();
    cabinGeo.setAttribute('position',new THREE.Float32BufferAttribute([-.9,1.4,-1.08,.9,1.4,-1.08,.9,1.4,1.23,-.9,1.4,1.23,-.79,1.98,-.55,.79,1.98,-.55,.79,1.98,.83,-.79,1.98,.83],3));
    cabinGeo.setIndex([0,4,5,0,5,1,1,5,6,1,6,2,2,6,7,2,7,3,3,7,4,3,4,0,4,7,6,4,6,5]);cabinGeo.computeVertexNormals();
    const cabin=new THREE.Mesh(cabinGeo,glass);cabin.castShadow=true;car.add(cabin);part(1.65,.12,1.46,0,2.01,.14,police?dark:bodyMat);
    part(.08,.57,.12,-.85,1.69,.3,bodyMat);part(.08,.57,.12,.85,1.69,.3,bodyMat);
    part(1.79,.1,.13,0,1.58,-.92,bodyMat);part(1.88,.36,1.25,0,1.32,-1.53,bodyMat);
    part(2.17,.19,.2,0,.73,-2.25,dark);part(2.17,.19,.2,0,.73,2.25,dark);
    part(1.08,.2,.08,0,1.01,-2.27,dark);
    for(const x of [-.78,.78]) {part(.48,.23,.09,x,1.12,-2.28,material('#ffe8b0',true));part(.58,.19,.09,x,1.08,2.28,material('#ee563b',true));}
    part(.62,.18,.09,0,.79,2.37,material('#e8dfb9'));
    const wheelGeo=new THREE.CylinderGeometry(.49,.49,.34,10);wheelGeo.rotateZ(Math.PI/2);
    for(const x of [-1.08,1.08]) for(const z of [-1.4,1.45]) {const wheel=new THREE.Mesh(wheelGeo,dark);wheel.position.set(x,.54,z);car.add(wheel);wheels.push(wheel);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.24,.24,.355,8),material('#9aa69c'));hub.rotation.z=Math.PI/2;wheel.add(hub);}
    if(police) {part(2.12,.36,1.8,0,1.1,.22,dark);part(1.45,.14,.43,0,2.2,.15,dark);const red=part(.6,.2,.4,-.4,2.34,.15,material('#ff443c',true)),blue=part(.6,.2,.4,.4,2.34,.15,material('#48b8ff',true));car.userData.lights=[red,blue];}
    else {part(2.1,.13,.42,0,1.58,1.94,dark);for(const x of [-.75,.75])part(.1,.33,.2,x,1.38,1.94,dark);part(.33,.03,1.28,-.42,1.52,-1.53,dark);part(.33,.03,1.28,.42,1.52,-1.53,dark);}
    car.userData.wheels=wheels;scene.add(car);return car;
  }
  // American muscle car: long hood with a blower punching through, fastback cabin, ducktail and staggered tyres. Front faces -z.
  function createMuscleCar(color='#f07438') {
    const car=new THREE.Group(), wheels=[];
    const paint=new THREE.MeshStandardMaterial({color,roughness:.42,metalness:.12}), stripe=material('#1f2729'), dark=material('#1c2527');
    const chrome=new THREE.MeshStandardMaterial({color:'#e3e1d6',roughness:.26,metalness:.45}), glass=new THREE.MeshStandardMaterial({color:'#23393e',roughness:.18,metalness:.2});
    const add=(geo,mat,x,y,z,parent=car)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
    const part=(w,h,d,x,y,z,mat,parent=car)=>add(new THREE.BoxGeometry(w,h,d),mat,x,y,z,parent);
    // Side profile (z,y) extruded across the car's width, optionally narrowing towards the roof.
    function profile(points,width,bevel=.05,taper=0,taperFrom=0) {
      const depth=width-bevel*2, geo=new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([z,y])=>new THREE.Vector2(z,y))),{depth,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:1,curveSegments:1});
      geo.translate(0,0,-depth/2);geo.rotateY(-Math.PI/2);
      if(taper){const p=geo.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i);if(y>taperFrom)p.setX(i,p.getX(i)*(1-(y-taperFrom)*taper));}geo.computeVertexNormals();}
      return geo;
    }
    const arch=(cz,cy,r,bottom)=>{const a0=Math.asin((bottom-cy)/r),pts=[];for(let i=0;i<=8;i++){const a=a0+(Math.PI-2*a0)*i/8;pts.push([cz+r*Math.cos(a),cy+r*Math.sin(a)]);}return pts;};
    const FRONT=-1.72, REAR=1.65;
    add(profile([[-2.72,.36],[-2.8,.62],[-2.76,.98],[-2.58,1.12],[-.6,1.18],[.9,1.2],[1.95,1.24],[2.62,1.33],[2.78,1.3],[2.8,1.02],[2.72,.42],[2.6,.36],...arch(REAR,.52,.62,.36),...arch(FRONT,.46,.56,.36)],2.12),paint,0,0,0);
    const TAPER=.28, cabinHalf=y=>.88*(1-(y-1.25)*TAPER);
    add(profile([[-.62,1.12],[.15,1.78],[1,1.8],[2.2,1.16],[2.2,1.12]],1.76,.04,TAPER,1.25),paint,0,0,0);
    // Glass inserts sit just proud of the painted cabin.
    const windshield=part(1.4,.02,.72,0,1.559,-.187,glass);windshield.rotation.x=-.709;
    const rearGlass=part(1.2,.02,.72,0,1.566,1.538,glass);rearGlass.rotation.x=.499;
    const tilt=Math.atan(.88*TAPER);
    for(const s of [-1,1]) {
      const geo=profile([[-.28,1.3],[.22,1.71],[.95,1.71],[1.7,1.3]],.02,0);geo.translate(0,-1.5,0);
      const win=add(geo,glass,s*(cabinHalf(1.5)+.015),1.5,0);win.rotation.z=s*tilt;win.castShadow=false;
      const pillar=part(.03,.42,.07,s*(cabinHalf(1.5)+.03),1.5,.58,paint);pillar.rotation.z=s*tilt;
      part(.2,.12,.15,s*.98,1.33,-.34,paint);
      part(.03,.12,.42,s*1.07,.98,.72,dark);
    }
    // Racing stripes over hood, roof and ducktail.
    for(const x of [-.2,.2]) {
      part(.24,.02,1.96,x,1.212,-1.59,stripe).rotation.x=-.03;
      part(.24,.02,.84,x,1.855,.57,stripe);
      part(.24,.02,.62,x,1.345,2.34,stripe).rotation.x=-.134;
    }
    // Supercharged V8 sticking out of the hood.
    const engine=new THREE.Group();engine.position.set(0,1.2,-1.45);car.add(engine);
    part(1.12,.02,1.28,0,.005,0,dark,engine);part(1,.12,1.15,0,.06,0,chrome,engine);
    for(const s of [-1,1])part(.18,.15,1,s*.52,.08,0,material('#c9472f'),engine);
    part(.72,.34,.95,0,.29,0,material('#b4b6ad'),engine);
    for(const z of [-.33,-.11,.11,.33])part(.76,.26,.045,0,.29,z,material('#56625f'),engine);
    part(.62,.06,.72,0,.49,0,chrome,engine);
    part(.56,.26,.5,0,.65,.05,chrome,engine);part(.46,.18,.03,0,.66,-.21,material('#0e1314'),engine);
    const pulley=add(new THREE.CylinderGeometry(.15,.15,.08,12),chrome,0,.27,-.52,engine);pulley.rotation.x=Math.PI/2;
    part(.1,.36,.04,0,.1,-.5,dark,engine);
    // Nose and tail.
    part(1.86,.3,.06,0,.79,-2.84,dark);
    const lampGeo=new THREE.CylinderGeometry(.1,.1,.06,12);lampGeo.rotateX(Math.PI/2);
    for(const x of [-.74,-.5,.5,.74])add(lampGeo,material('#ffe8b0',true),x,.79,-2.875);
    part(2.16,.13,.18,0,.5,-2.84,chrome);part(1.9,.06,.22,0,.33,-2.7,dark);
    part(1.84,.17,.05,0,1.02,2.855,material('#ee563b',true));part(.34,.19,.06,0,1.02,2.86,dark);
    part(2.16,.13,.18,0,.52,2.8,chrome);part(.5,.18,.03,0,.76,2.83,material('#e8dfb9'));
    const pipeGeo=new THREE.CylinderGeometry(.07,.07,.35,10);pipeGeo.rotateX(Math.PI/2);
    for(const x of [-.62,.62])add(pipeGeo,material('#56605e'),x,.34,2.75);
    part(1.86,.52,1.15,0,.82,REAR,dark);part(1.86,.5,1.05,0,.78,FRONT,dark);part(1.9,.1,5.2,0,.38,0,dark);
    // Staggered tyres: skinny fronts, fat rears, spoked rims so the spin reads.
    for(const [z,r,w] of [[FRONT,.46,.36],[REAR,.52,.48]]) {
      const tyreGeo=new THREE.CylinderGeometry(r,r,w,14);tyreGeo.rotateZ(Math.PI/2);
      const rimGeo=new THREE.CylinderGeometry(r*.62,r*.62,w+.02,10);rimGeo.rotateZ(Math.PI/2);
      const capGeo=new THREE.CylinderGeometry(r*.17,r*.17,w+.07,8);capGeo.rotateZ(Math.PI/2);
      for(const s of [-1,1]) {
        const wheel=add(tyreGeo,dark,s*(1.2-w/2),r,z);
        add(rimGeo,chrome,0,0,0,wheel);add(capGeo,chrome,0,0,0,wheel);
        part(w+.04,r*1.12,.08,0,0,0,material('#4b5654'),wheel);part(w+.04,.08,r*1.12,0,0,0,material('#4b5654'),wheel);
        wheels.push(wheel);
      }
    }
    car.userData.wheels=wheels;car.userData.engine=engine;scene.add(car);return car;
  }
  const playerCar=createMuscleCar();
  for(const p of city.parked) {const car=createCar(false,p.color);car.position.set(p.x,.1,p.z);car.rotation.y=p.rot;}
  const obstacles=city.obstacles;
  // Keep the sky, sun disc and shadow frustum centred on the action; snapping stops shadow shimmer.
  function follow(focusX,focusZ,cameraPosition) {
    const sx=Math.round(focusX/4)*4,sz=Math.round(focusZ/4)*4;
    sun.target.position.set(sx,0,sz);sun.position.set(sx+SUN_OFFSET.x,SUN_OFFSET.y,sz+SUN_OFFSET.z);
    sky.position.set(cameraPosition.x,0,cameraPosition.z);sunDisc.position.set(cameraPosition.x+SUN_DISC.x,SUN_DISC.y,cameraPosition.z+SUN_DISC.z);sunDisc.lookAt(cameraPosition);
  }
  const skidGeometry=new THREE.PlaneGeometry(.19,1.35);skidGeometry.rotateX(-Math.PI/2);
  const skidMesh=new THREE.InstancedMesh(skidGeometry,new THREE.MeshBasicMaterial({color:'#24373a',transparent:true,opacity:.42,depthWrite:false}),450);
  skidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);skidMesh.frustumCulled=false;
  dummy.scale.set(0,0,0);dummy.updateMatrix();for(let i=0;i<450;i++)skidMesh.setMatrixAt(i,dummy.matrix);scene.add(skidMesh);let skidIndex=0;
  function skid(p){for(const s of [-1,1]){dummy.scale.set(1,1,1);dummy.position.set(p.x+Math.cos(p.yaw)*s,.116,p.z+Math.sin(p.yaw)*s);dummy.rotation.set(0,-p.yaw,0);dummy.updateMatrix();skidMesh.setMatrixAt(skidIndex++%450,dummy.matrix);}skidMesh.instanceMatrix.needsUpdate=true;}
  function clearSkids(){dummy.scale.set(0,0,0);dummy.updateMatrix();for(let i=0;i<450;i++)skidMesh.setMatrixAt(i,dummy.matrix);skidMesh.instanceMatrix.needsUpdate=true;}
  return { renderer, scene, camera, playerCar, createCar, obstacles, city, follow, skid, clearSkids, sun };
}
