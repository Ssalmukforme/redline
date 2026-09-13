import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, updatePlayer, updateCapture, routeTo, lineOfSight, formatTime, saveRecord, resolveCollision, blocked, shortestPath } from '../src/simulation.js';
import { buildNetwork, createCity, rectsOverlap } from '../src/city.js';
import { difficulty, createPoliceBrain, createNav, updateFlow, flowWaypoint, MAX_LEVEL, TACTICS } from '../src/police.js';

test('wanted level climbs every 30 seconds up to level 10 with more, faster, smarter police',()=>{
  assert.equal(difficulty(29.99).level,1);assert.equal(difficulty(30).level,2);assert.equal(difficulty(120).level,5);assert.equal(difficulty(270).level,10);assert.equal(difficulty(10000).level,MAX_LEVEL);
  assert.equal(TACTICS.length,MAX_LEVEL);
  for(let l=2;l<=MAX_LEVEL;l++){const a=difficulty((l-2)*30),b=difficulty((l-1)*30);assert.ok(b.count>=a.count&&b.speed>a.speed&&b.skill>a.skill,'level '+l);}
  assert.equal(difficulty(10000).count,12);assert.ok(difficulty(10000).speed<65,'boosting players can still outrun police');
});
test('flow field leads police into a walled courtyard through its only gap',()=>{
  // A U-shaped courtyard open to the south; the player hides inside, police approach from the north.
  const walls=[{x:0,z:-12,w:30,d:2,rot:0},{x:-14,z:0,w:2,d:26,rot:0},{x:14,z:0,w:2,d:26,rot:0}],nav=createNav(walls,{radius:60});
  const player={x:0,z:-4},cop={x:0,z:-40};
  updateFlow(nav,player);
  let p={...cop};for(let i=0;i<60;i++){const wp=flowWaypoint(nav,p,walls);if(!wp)break;assert.ok(lineOfSight(p,wp,walls));p=wp;if(Math.hypot(p.x-player.x,p.z-player.z)<3)break;}
  assert.ok(Math.hypot(p.x-player.x,p.z-player.z)<4,'reached hiding player');
});
test('a wall between police and player blocks the arrest',()=>{
  const p=createPlayer({x:0,z:0,yaw:0}),wall=[{x:0,z:-3,w:20,d:1.5,rot:0}],cop=[{x:0,z:-6}];
  for(let i=0;i<240;i++)updateCapture(p,cop,1/120,1,wall);assert.equal(p.capture,0);
  for(let i=0;i<240;i++)updateCapture(p,cop,1/120,1,[]);assert.ok(p.capture>0);
});
test('high-level police corner a player hiding between buildings faster than level-1 police',()=>{
  const city=createCity(),spot=(()=>{for(const b of city.buildings){for(const [ox,oz] of [[b.w/2+3,0],[-b.w/2-3,0],[0,b.d/2+3],[0,-b.d/2-3]]){const x=b.x+ox*Math.cos(b.rot)+oz*Math.sin(b.rot),z=b.z-ox*Math.sin(b.rot)+oz*Math.cos(b.rot);if(!blocked(x,z,city.obstacles,1.4)&&blocked(x,z,city.obstacles,3.4)&&Math.min(...city.network.nodes.map(n=>Math.hypot(n.x-x,n.z-z)-n.w/2))>10)return {x,z};}}})();
  const catchTime=level=>{const brain=createPoliceBrain(city),player={...spot,yaw:0,vx:0,vz:0,speed:0,capture:0},t0=(level-1)*30+1;
    const nodes=city.network.nodes.filter(n=>{const d=Math.hypot(n.x-spot.x,n.z-spot.z);return d>70&&d<110;});
    const police=[0,1,2].map(i=>{const n=nodes[Math.floor(i*nodes.length/3)];return {x:n.x,z:n.z,yaw:0,vx:0,vz:0,speed:0,route:[],repath:0,stuck:0};});
    for(let t=0;t<60;t+=1/90){brain.tick(police,player,t0+t,1/90);player.vx=player.vz=0;if(updateCapture(player,police,1/90,1,city.obstacles))return t;}return 60;};
  const slow=catchTime(1),fast=catchTime(10);assert.ok(fast<40,'level 10 caught the hiding player: '+fast.toFixed(1));assert.ok(fast<slow,'level 10 ('+fast.toFixed(1)+'s) faster than level 1 ('+slow.toFixed(1)+'s)');
});
test('acceleration, reverse, boost consumption and regeneration',()=>{
  const p=createPlayer();for(let i=0;i<120;i++)updatePlayer(p,{up:true,boost:true},1/120,[]);
  assert.ok(p.z<65);assert.ok(p.nitro<.8);const spent=p.nitro;for(let i=0;i<120;i++)updatePlayer(p,{},1/120,[]);assert.ok(p.nitro>spent);
  const reverse=createPlayer();for(let i=0;i<120;i++)updatePlayer(reverse,{down:true},1/120,[]);assert.ok(reverse.z>72);assert.ok(reverse.speed<=13);
});
test('buildings stop a car at speed without allowing tunneling',()=>{
  const p=createPlayer(),building={x:4,z:52,w:15,d:10};
  for(let i=0;i<600;i++)updatePlayer(p,{up:true,boost:true},1/120,[building]);
  assert.ok(p.z>=58.25-1e-7);
});
test('police follow the road graph around an occupied block',()=>{
  const blocks=[{x:30,z:30,w:38,d:38}],from={x:0,z:30},target={x:60,z:30};
  const network=buildNetwork([{pts:[[0,-10],[60,-10],[60,70],[0,70],[0,-10]],w:12,kind:'street'}]);
  assert.equal(lineOfSight(from,target,blocks),false);const route=routeTo(from,target,blocks,network);assert.ok(route.length>=3);
  let prev=from;for(const point of route){assert.ok(lineOfSight(prev,point,blocks));prev=point;}
});
test('crossing roads become shared junctions and dead-end stubs are trimmed',()=>{
  const network=buildNetwork([{pts:[[-50,0],[50,0]],w:12},{pts:[[0,-50],[0,50]],w:12},{pts:[[-40,-40],[40,-40],[40,40],[-40,40],[-40,-40]],w:12}]);
  assert.equal(network.nodes.filter(n=>n.degree<2).length,0);
  assert.ok(network.nodes.some(n=>Math.hypot(n.x,n.z)<1&&n.degree===4));
  assert.ok(network.nodes.every(n=>Math.abs(n.x)<=40.01&&Math.abs(n.z)<=40.01));
});
test('rotated buildings push cars out along their own faces',()=>{
  const wall={x:0,z:0,w:20,d:4,rot:Math.PI/4},car={x:.5,z:-.5,vx:5,vz:-5};
  assert.ok(blocked(car.x,car.z,[wall]));resolveCollision(car,[wall]);assert.equal(blocked(car.x,car.z,[wall],1.2),false);
});
test('a car pinned against a wall can steer away and slide along it',()=>{
  const p=createPlayer(),wall={x:4,z:60,w:60,d:6,rot:0};
  for(let i=0;i<240;i++)updatePlayer(p,{up:true},1/120,[wall]);
  assert.ok(p.z>=63+1.2+1.7-1e-6);const x0=p.x;
  for(let i=0;i<360;i++)updatePlayer(p,{up:true,left:true},1/120,[wall]);
  assert.ok(Math.abs(p.x-x0)>8,'car slid away from the wall');assert.equal(blocked(p.x,p.z,[wall],1.1),false);
});
test('a car driving at a grazing angle into a facade keeps most of its speed',()=>{
  const p=createPlayer({x:0,z:0,yaw:1.25}),wall={x:40,z:-8,w:200,d:4,rot:0};
  for(let i=0;i<240;i++)updatePlayer(p,{up:true},1/120,[wall]);
  assert.ok(p.speed>12,'still moving along the wall: '+p.speed.toFixed(1));
});
test('Golden Bay is one connected, non-grid city with clear streets',()=>{
  const city=createCity(),{network}=city;
  assert.ok(network.nodes.length>500);assert.equal(network.nodes.filter(n=>n.degree<2).length,0);
  const path=shortestPath(network,0,network.nodes.length-1);assert.equal(path.at(-1),network.nodes.length-1);
  const angles=new Set(network.edges.map(e=>{const a=network.nodes[e.a],b=network.nodes[e.b];return Math.round(((Math.atan2(b.z-a.z,b.x-a.x)+Math.PI)%(Math.PI/2))*12);}));
  assert.ok(angles.size>12);
  assert.equal(blocked(city.spawn.x,city.spawn.z,city.obstacles,2),false);
  for(let i=0;i<city.buildings.length;i++)for(let j=i+1;j<city.buildings.length;j++)assert.equal(rectsOverlap(city.buildings[i],city.buildings[j]),false);
  for(let i=0;i<city.crosswalks.length;i++)for(let j=i+1;j<city.crosswalks.length;j++)assert.equal(rectsOverlap(city.crosswalks[i],city.crosswalks[j]),false,'crosswalks overlap');
  assert.ok(city.crosswalks.length>80);
  for(let i=0;i<city.buildings.length;i++)for(let j=i+1;j<city.buildings.length;j++)assert.equal(rectsOverlap(city.buildings[i],city.buildings[j],4.9),false,'alley narrower than a car');
  for(const e of network.edges){const a=network.nodes[e.a],b=network.nodes[e.b];assert.equal(blocked((a.x+b.x)/2,(a.z+b.z)/2,city.obstacles.filter(o=>o.w>3),1.25),false);}
});
test('capture builds from nearby police, recovers at distance, and finishes',()=>{
  const p=createPlayer();const nearby=[{x:p.x,z:p.z+4}];for(let i=0;i<120;i++)updateCapture(p,nearby,1/120);assert.ok(p.capture>0);const danger=p.capture;
  updateCapture(p,[],.5);assert.ok(p.capture<danger);let caught=false;for(let i=0;i<1000;i++)caught=updateCapture(p,nearby,1/120);assert.equal(caught,true);assert.equal(p.capture,1);
});
test('records sort longest first, retain ten, and display minute rollover',()=>{
  let records=[];for(let i=1;i<=15;i++)records=saveRecord(records,i);assert.equal(records.length,10);assert.equal(records[0].time,15);assert.equal(records.at(-1).time,6);assert.equal(formatTime(60.123),'01:00<small>.123</small>');assert.equal(formatTime(-1),'00:00<small>.000</small>');
});
