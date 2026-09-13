import * as THREE from 'three';
import './style.css';
import { createWorld } from './world.js';
import { createPlayer, updatePlayer, updateCapture, formatTime, clamp, saveRecord, blocked, LIMIT } from './simulation.js';
import { createPoliceBrain, difficulty, MAX_LEVEL, TACTICS } from './police.js';

const $ = id => document.getElementById(id);
let world;
try { world = createWorld($('world')); }
catch (error) { $('loading').innerHTML='<strong>REDLINE</strong><span>3D 화면을 시작하지 못했습니다. 브라우저의 하드웨어 가속을 켜고 새로고침해 주세요.</span>'; throw error; }
const { renderer, scene, camera, playerCar, obstacles, city } = world;
const brain = createPoliceBrain(city);
let state='menu', player=createPlayer(city.spawn), elapsed=0, police=[], lastLevel=1, maxSpeed=0, frame=0, countdown=0, announcedUntil=0, modalReturn=null;
const keys=new Set();let recordSaved=false, storageAvailable=true;
let records=[];
try {const data=JSON.parse(localStorage.getItem('redline-records') || '[]'); records=Array.isArray(data)?data.filter(r=>Number.isFinite(r.time)&&r.time>=0&&typeof r.date==='string'&&!Number.isNaN(Date.parse(r.date))).sort((a,b)=>b.time-a.time).slice(0,10):[];}catch {storageAvailable=false;}
const updateBest=()=>{$('menu-best').innerHTML=records.length?formatTime(records[0].time):'--:--<small>.---</small>';};updateBest();

// Audio is synthesized locally and starts only after a deliberate user gesture.
let soundEnabled=false,audioCtx,engineOsc,engineGain,sirenOsc,sirenGain;
function setupAudio(){if(audioCtx){audioCtx.resume().catch(()=>{});return;}try{audioCtx=new AudioContext();engineOsc=audioCtx.createOscillator();engineOsc.type='sawtooth';const filter=audioCtx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=350;engineGain=audioCtx.createGain();engineGain.gain.value=0;engineOsc.connect(filter);filter.connect(engineGain);engineGain.connect(audioCtx.destination);engineOsc.start();sirenOsc=audioCtx.createOscillator();sirenGain=audioCtx.createGain();sirenGain.gain.value=0;sirenOsc.connect(sirenGain);sirenGain.connect(audioCtx.destination);sirenOsc.start();}catch{soundEnabled=false;}}
function audioTick(){if(!audioCtx)return;const playing=state==='playing'&&soundEnabled;engineOsc.frequency.setTargetAtTime(35+player.speed*3.2,audioCtx.currentTime,.1);engineGain.gain.setTargetAtTime(playing?.035:0,audioCtx.currentTime,.08);const nearest=police.reduce((n,c)=>Math.min(n,Math.hypot(c.x-player.x,c.z-player.z)),150);sirenOsc.frequency.setTargetAtTime(660+Math.sin(elapsed*5.8)*210,audioCtx.currentTime,.07);sirenGain.gain.setTargetAtTime(playing?Math.max(0,1-nearest/90)*.021:0,audioCtx.currentTime,.1);}
$('sound-button').addEventListener('click',()=>{soundEnabled=!soundEnabled;if(soundEnabled)setupAudio();$('sound-button').innerHTML=soundEnabled?'<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>':'<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6"/></svg>';$('sound-button').setAttribute('aria-label',soundEnabled?'소리 끄기':'소리 켜기');$('sound-button').title=soundEnabled?'소리 끄기':'소리 켜기';});

function openModal(html){modalReturn=document.activeElement;keys.clear();$('modal').innerHTML=html;$('modal-backdrop').classList.remove('hidden');$('modal').querySelector('button')?.focus();}
function closeModal(){ $('modal-backdrop').classList.add('hidden');$('modal').innerHTML='';modalReturn?.focus(); }
const closeButton='<button class="modal-close" data-action="close" aria-label="닫기">×</button>';
function help(){openModal(`${closeButton}<span class="modal-eyebrow">THE GETAWAY HANDBOOK</span><h2 id="modal-title" class="modal-title">DON’T GET CAUGHT.</h2><p class="modal-description">목표는 단 하나. 경찰에게 붙잡히기 전까지 최대한 오래 버티세요. 30초마다 수배 단계가 올라 경찰이 늘고, 빨라지고, 더 영리해집니다. 최고 단계는 10단계.</p><div class="control-row"><span>가속 / 브레이크 · 후진</span><span><kbd>W / S</kbd> &nbsp; <kbd>↑ / ↓</kbd></span></div><div class="control-row"><span>좌우 조향</span><span><kbd>A / D</kbd> &nbsp; <kbd>← / →</kbd></span></div><div class="control-row"><span>드리프트</span><kbd>SPACE</kbd></div><div class="control-row"><span>니트로 부스트 · 자동 충전</span><kbd>SHIFT</kbd></div><div class="control-row"><span>일시정지</span><kbd>ESC</kbd></div><p class="modal-description" style="margin-top:20px;margin-bottom:0">경찰이 가까이 붙으면 체포 게이지가 올라갑니다. 속도를 높이고 골목을 돌아 거리를 벌리세요. 터치 기기에서는 화면 아래 버튼으로 조작합니다.</p><div class="modal-actions"><button class="primary-button" data-action="start">좋아, 출발하자 <span>↗</span></button></div>`);}
function showRecords(){openModal(`${closeButton}<span class="modal-eyebrow">LOCAL LEADERBOARD</span><h2 id="modal-title" class="modal-title">THE LONGEST RUN.</h2><p class="modal-description">이 브라우저의 생존 기록 TOP 10.<br>친구와 번갈아 플레이하며 최고 기록에 도전하세요.</p>${records.length?`<ol class="record-list">${records.map((r,i)=>`<li><b>${String(i+1).padStart(2,'0')}</b><span>${new Date(r.date).toLocaleDateString('ko-KR')}</span><strong>${formatTime(r.time)}</strong></li>`).join('')}</ol>`:'<p class="modal-description" style="padding:30px 0;text-align:center">아직 기록이 없어요.<br>첫 번째 도주자가 되어보세요.</p>'}<div class="modal-actions"><button class="primary-button" data-action="start">새 기록에 도전 <span>↗</span></button></div>`);}
function showMap(){openModal(`${closeButton}<span class="modal-eyebrow">01 / SELECTED DISTRICT</span><h2 id="modal-title" class="modal-title">GOLDEN BAY.</h2><p class="modal-description">굽이진 해안 순환도로, 도심을 가르는 대로, 언덕 위 주택가.<br>노을진 도시 전체가 당신의 도주 경로입니다.</p><canvas class="map-preview" id="map-preview" width="700" height="440" aria-label="골든 베이 전체 지도"></canvas><div class="map-stats"><span>건물 ${city.buildings.length}채</span><span>해안 순환도로 · 언덕길</span><span>시간에 따른 난이도</span></div><div class="modal-actions"><button class="primary-button" data-action="start">이 도시에서 시작 <span>↗</span></button></div>`);drawMap($('map-preview'),true);}
function pause(){if(state!=='playing'&&state!=='countdown')return;state='paused';keys.clear();openModal(`<span class="modal-eyebrow">TAKE A BREATHER</span><h2 id="modal-title" class="modal-title">STILL ON THE RUN.</h2><p class="modal-description">추격이 잠시 멈췄습니다. 준비되면 다시 달리세요.</p><div class="result-time">${formatTime(elapsed)}</div><div class="modal-actions"><button class="primary-button" data-action="resume">계속 달리기 <span>→</span></button><button class="secondary-button" data-action="restart">처음부터 다시</button><button class="secondary-button" data-action="menu">시작 화면으로</button></div>`);}
function resume(){closeModal();keys.clear();state='playing';}
function finish(){if(recordSaved)return;recordSaved=true;state='busted';keys.clear();const best=!records.length||elapsed>records[0].time;records=saveRecord(records,elapsed);try{localStorage.setItem('redline-records',JSON.stringify(records));}catch{storageAvailable=false;}updateBest();openModal(`<span class="modal-eyebrow">END OF THE ROAD</span><h2 id="modal-title" class="modal-title">BUSTED.</h2><p class="modal-description">이번 추격은 여기까지.<br>도시는 언제나 다음 도주를 기다립니다.</p>${best?'<div class="new-best">★ &nbsp; 새로운 최고 기록</div>':''}<div class="result-time">${formatTime(elapsed)}</div><div class="result-details">수배 단계 ${lastLevel} &nbsp; · &nbsp; 최고 속도 ${Math.round(maxSpeed*3.6)} km/h</div><p class="modal-description">${storageAvailable?'기록이 이 브라우저에 저장되었습니다.':'브라우저 저장이 제한되어 이번 탭에서만 기록을 유지합니다.'}</p><div class="modal-actions"><button class="primary-button" data-action="restart">한 번 더 달리기 <span>↗</span></button><button class="secondary-button" data-action="menu">시작 화면으로</button></div>`);}
function removePolice(){for(const c of police){scene.remove(c.mesh);c.mesh.traverse(o=>{if(o.isMesh)o.geometry.dispose();});}police=[];}
function addPolice(index){
  // Reinforcements arrive on a road node at a fair distance, never on top of another cruiser.
  const want=elapsed>1?95:50+index*35;let spawn=city.network.nodes[0],score=Infinity;
  for(const n of city.network.nodes){const s=Math.abs(Math.hypot(n.x-player.x,n.z-player.z)-want)+(police.some(c=>Math.hypot(c.x-n.x,c.z-n.z)<30)?200:0)+Math.random()*12;if(s<score){score=s;spawn=n;}}
  spawn={x:spawn.x,z:spawn.z};
  const mesh=world.createCar(true);const c={...spawn,yaw:0,vx:0,vz:0,speed:0,mesh,route:[],repath:0,stuck:0};police.push(c);mesh.position.set(c.x,.1,c.z);
}
function reset(){player=createPlayer(city.spawn);elapsed=0;maxSpeed=0;lastLevel=1;recordSaved=false;removePolice();addPolice(0);addPolice(1);keys.clear();world.clearSkids();$('capture-warning').classList.add('hidden');$('announcement').classList.add('hidden');$('timer').innerHTML=formatTime(0);{const fx=Math.sin(player.yaw),fz=-Math.cos(player.yaw);camera.position.set(player.x-fx*19,12,player.z-fz*19);camera.lookAt(player.x+fx*13,1.5,player.z+fz*13);}camera.fov=57;camera.updateProjectionMatrix();}
function start(){closeModal();reset();state='countdown';countdown=2.5;$('menu').classList.add('hidden');$('hud').classList.remove('hidden');$('vignette').style.opacity='0';if(soundEnabled)setupAudio();announce('엔진을 깨우세요. 곧 추격이 시작됩니다.',2.5);updateHud();}
function toMenu(){closeModal();state='menu';keys.clear();$('menu').classList.remove('hidden');$('hud').classList.add('hidden');$('vignette').style.opacity='1';player=createPlayer(city.spawn);removePolice();addPolice(0);addPolice(1);updateBest();camera.fov=52;camera.updateProjectionMatrix();}
function announce(text,duration=3){$('announcement').textContent=text;$('announcement').classList.remove('hidden');announcedUntil=performance.now()+duration*1000;}
$('start-button').addEventListener('click',start);$('help-button').addEventListener('click',help);$('records-button').addEventListener('click',showRecords);$('map-button').addEventListener('click',showMap);$('pause-button').addEventListener('click',pause);
$('modal').addEventListener('click',e=>{const action=e.target.closest('[data-action]')?.dataset.action;if(action==='close')closeModal();if(action==='start'||action==='restart')start();if(action==='resume')resume();if(action==='menu')toMenu();});
$('modal-backdrop').addEventListener('click',e=>{if(e.target===$('modal-backdrop')&&state==='menu')closeModal();});
addEventListener('keydown',e=>{
  const key=e.key.toLowerCase();
  if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key))e.preventDefault();
  if(key==='tab'&&!$('modal-backdrop').classList.contains('hidden')){const list=[...$('modal').querySelectorAll('button')];if(!list.length)return;if(e.shiftKey&&document.activeElement===list[0]){e.preventDefault();list.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===list.at(-1)){e.preventDefault();list[0].focus();}return;}
  if(e.repeat)return;
  if(key==='escape'){if(state==='playing'||state==='countdown')pause();else if(state==='paused')resume();else if(state==='menu')closeModal();return;}
  if(key==='enter'&&state==='menu'&&$('modal-backdrop').classList.contains('hidden')){e.preventDefault();start();return;}
  if(state==='playing'||state==='countdown')keys.add(key);
});
addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
addEventListener('blur',()=>{keys.clear();pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();pause();}});
for(const button of document.querySelectorAll('[data-key]')){
  button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(button.dataset.key);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>keys.delete(button.dataset.key));
}

function updateHud(){
  const d=difficulty(elapsed);$('timer').innerHTML=formatTime(elapsed);$('speed').textContent=Math.round(player.speed*3.6);$('nitro-percent').textContent=Math.round(player.nitro*100)+'%';$('boost-progress').style.width=player.nitro*100+'%';
  $('level-number').textContent=String(d.level).padStart(2,'0');$('stars').innerHTML='★'.repeat(d.level)+'<span>'+'★'.repeat(MAX_LEVEL-d.level)+'</span>';$('heat-description').textContent=TACTICS[d.level-1].name+` · 순찰차 ${police.length}대`;$('heat-progress').style.width=(d.level>=MAX_LEVEL?100:(elapsed%30)/30*100)+'%';$('next-level').textContent=d.level>=MAX_LEVEL?'최고 단계 도달 · 버틸 수 있을 때까지':'30초마다 추격 강도 증가';
  $('capture-warning').classList.toggle('hidden',player.capture<=.015);$('capture-progress').style.width=player.capture*100+'%';drawMap($('minimap'));
}
// The whole city is drawn once to an offscreen canvas; the HUD minimap shows a player-centred window of it.
const MAP_PX=2,MAP_EXTENT=LIMIT+30,cityMap=document.createElement('canvas');
{
  cityMap.width=cityMap.height=MAP_EXTENT*2*MAP_PX;const ctx=cityMap.getContext('2d'),m=v=>(v+MAP_EXTENT)*MAP_PX;
  ctx.fillStyle='#183638';ctx.fillRect(0,0,cityMap.width,cityMap.height);ctx.fillStyle='#42716e';ctx.fillRect(0,0,m(-LIMIT-6),cityMap.height);
  ctx.lineCap='round';ctx.strokeStyle='#778a7e';
  for(const e of city.network.edges){const a=city.network.nodes[e.a],b=city.network.nodes[e.b];ctx.lineWidth=e.w*MAP_PX;ctx.beginPath();ctx.moveTo(m(a.x),m(a.z));ctx.lineTo(m(b.x),m(b.z));ctx.stroke();}
  ctx.fillStyle='#3c5550';for(const b of city.buildings){ctx.save();ctx.translate(m(b.x),m(b.z));ctx.rotate(-b.rot);ctx.fillRect(-b.w*MAP_PX/2,-b.d*MAP_PX/2,b.w*MAP_PX,b.d*MAP_PX);ctx.restore();}
  ctx.fillStyle='#2c4a44';for(const t of city.trees)ctx.fillRect(m(t.x)-2,m(t.z)-2,4,4);
}
function drawMap(canvas,preview=false){
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#183638';ctx.fillRect(0,0,w,h);
  // Preview fits the whole city; the HUD shows about 320 units around the player.
  const span=preview?MAP_EXTENT*2:320,s=Math.min(w,h)/span,cx=preview?0:player.x,cz=preview?0:player.z;
  const px=x=>w/2+(x-cx)*s,pz=z=>h/2+(z-cz)*s;
  ctx.drawImage(cityMap,px(-MAP_EXTENT),pz(-MAP_EXTENT),MAP_EXTENT*2*s,MAP_EXTENT*2*s);
  if(!preview){for(const c of police){ctx.fillStyle='#fa6759';ctx.beginPath();ctx.arc(clamp(px(c.x),4,w-4),clamp(pz(c.z),4,h-4),3,0,Math.PI*2);ctx.fill();}ctx.save();ctx.translate(px(player.x),pz(player.z));ctx.rotate(player.yaw);ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(4.5,4);ctx.lineTo(0,2);ctx.lineTo(-4.5,4);ctx.closePath();ctx.fillStyle='#fff0c8';ctx.fill();ctx.restore();}
  else{const {x,z}=city.spawn;ctx.fillStyle='#ff8045';ctx.beginPath();ctx.arc(px(x),pz(z),6,0,Math.PI*2);ctx.fill();ctx.font='13px sans-serif';ctx.fillStyle='#fff4dc';ctx.fillText('START',px(x)+12,pz(z)+5);ctx.font='11px sans-serif';ctx.fillStyle='#acc3ae';ctx.fillText('N ↑',w-38,25);}
}
function syncCars(t,dt){
  playerCar.position.set(player.x,.1+Math.sin(t*17)*Math.min(player.speed*.0006,.025),player.z);playerCar.rotation.set(0,-player.yaw,0);
  for(const wheel of playerCar.userData.wheels)wheel.rotation.x-=player.speed*dt*1.8;
  playerCar.userData.engine.rotation.z=Math.sin(t*47)*(.012+player.speed*.0003);
  for(let i=0;i<police.length;i++){const c=police[i];c.mesh.position.set(c.x,.1,c.z);c.mesh.rotation.y=-c.yaw;const on=Math.sin(t*11+i)>0;for(let j=0;j<2;j++){c.mesh.userData.lights[j].scale.y=(on===(j===0))?1.7:.55;}}
}
const desiredCamera=new THREE.Vector3(),lookTarget=new THREE.Vector3();let cameraInitialized=false,last=performance.now();
function animate(now){
  requestAnimationFrame(animate);const realDt=(now-last)/1000,dt=Math.min(realDt,.05);last=now;const t=now/1000;frame++;
  if(state==='playing'){
    // Small physics steps keep collisions reliable even during slow rendering frames.
    const substeps=Math.ceil(dt/(1/90)),step=dt/substeps;
    const input={up:keys.has('w')||keys.has('arrowup'),down:keys.has('s')||keys.has('arrowdown'),left:keys.has('a')||keys.has('arrowleft'),right:keys.has('d')||keys.has('arrowright'),drift:keys.has(' '),boost:keys.has('shift')};
    elapsed+=realDt;
    for(let i=0;i<substeps;i++) {updatePlayer(player,input,step,obstacles);brain.tick(police,player,elapsed,step);if(updateCapture(player,police,step,difficulty(elapsed).level,obstacles)){finish();break;}}
    maxSpeed=Math.max(maxSpeed,player.speed);
    const d=difficulty(elapsed);if(d.level!==lastLevel){lastLevel=d.level;announce(`수배 단계 ${d.level} · ${TACTICS[d.level-1].unlock}`,3.5);}
    while(police.length<d.count)addPolice(police.length);
    if(player.drifting&&frame%2===0)world.skid(player);
    if(frame%3===0)updateHud();
  }else if(state==='countdown'){
    countdown-=realDt;$('announcement').textContent=countdown>1?`추격 시작까지 ${Math.ceil(countdown-1)}`:'달리세요. 도시가 깨어납니다.';
    if(countdown<=0){state='playing';announce('GO. 한계까지 달리세요.',1.5);}
  }
  if(state==='menu'){
    const sway=matchMedia('(prefers-reduced-motion: reduce)').matches?0:Math.sin(t*.12);
    const {x,z,yaw}=city.spawn,fx=Math.sin(yaw),fz=-Math.cos(yaw),rx=-fz,rz=fx;
    desiredCamera.set(x+rx*(12+sway)-fx*17,6.5,z+rz*(12+sway)-fz*17);lookTarget.set(x-rx*20+fx*20,2,z-rz*20+fz*20);
    camera.position.lerp(desiredCamera,cameraInitialized?.04:1);camera.lookAt(lookTarget);cameraInitialized=true;
  }else{
    const sx=Math.sin(player.yaw),sz=-Math.cos(player.yaw),distance=18+player.speed*.045;
    desiredCamera.set(player.x-sx*distance,11.5+player.speed*.028,player.z-sz*distance);
    // Raise the chase camera above any building behind the player, so corners stay readable.
    if(blocked(desiredCamera.x,desiredCamera.z,obstacles,1)){desiredCamera.x=player.x-sx*8;desiredCamera.z=player.z-sz*8;desiredCamera.y=15;}
    if(state==='playing'||state==='countdown'){camera.position.lerp(desiredCamera,1-Math.exp(-dt*5));lookTarget.set(player.x+sx*9,1.8,player.z+sz*9);camera.lookAt(lookTarget);const fov=57+(player.boosting?8:0);camera.fov+=(fov-camera.fov)*dt*3;camera.updateProjectionMatrix();}
  }
  if(now>announcedUntil&&state!=='countdown')$('announcement').classList.add('hidden');
  syncCars(t,dt);world.follow(player.x,player.z,camera.position);audioTick();renderer.render(scene,camera);
}
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));}
addEventListener('resize',resize);toMenu();requestAnimationFrame(animate);
// Dismiss the loader on a timer too, so a background tab (paused animation frames) never leaves it stuck over the menu.
let loaderGone=false;const hideLoader=()=>{if(loaderGone)return;loaderGone=true;$('loading').style.opacity='0';setTimeout(()=>$('loading').classList.add('hidden'),450);};
requestAnimationFrame(hideLoader);setTimeout(hideLoader,120);
// Read-only telemetry helps verify a real running simulation without exposing gameplay cheats.
Object.defineProperty(window,'redline',{value:Object.freeze({getSnapshot:()=>({state,time:elapsed,player:{x:player.x,z:player.z,speed:player.speed,nitro:player.nitro,capture:player.capture},police:police.map(c=>({x:c.x,z:c.z})),level:difficulty(elapsed).level,records:records.length,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles})})});
