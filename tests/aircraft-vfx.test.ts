import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BufferAttribute, BufferGeometry, Color, Euler, Quaternion, Vector3 } from 'three';
import { aircraftEventParticles, sampleAircraftParticle, aircraftWreckPose, AIRCRAFT_EFFECT_CAPACITY, AIRCRAFT_PARTICLE_VERTEX, AIRCRAFT_PARTICLE_FRAGMENT } from '../src/aircraft-vfx';
import { FlightScene } from '../src/scene';
import { createGame,startGame,stepGame,pauseGame,resumeGame } from '../src/simulation';
const idle={turn:0,climb:0,fire:false,loop:false};
test('source frame fixture: hit3/.7s/size8 and kill18/2.4s/size28, deterministic colors and trajectories',()=>{
 for(const type of ['hit','kill'] as const){
  const e={id:7,type,position:new Vector3(10,2400,-20),owner:1};const p=aircraftEventParticles(e,12);
  assert.equal(p.length,type==='hit'?3:18);
  for(let j=0;j<p.length;j++){
   const seed=7*31+j*17,theta=seed*2.399963,r=type==='kill'?18:5;
   assert.deepEqual(p[j].v.toArray(),[Math.cos(theta)*r,6+seed%13,Math.sin(theta)*r]);
   assert.equal(p[j].life,type==='kill'?2.4:.7);assert.equal(p[j].size,type==='kill'?28:8);
   assert.equal(p[j].color.getHex(),type==='kill'&&j%2===0?0x354047:j%3===0?0xffd993:0xed641d);
   for(const age of [0,.25,.5]){
    const sample=sampleAircraftParticle(p[j],12+age);
    const expected=e.position.clone().addScaledVector(p[j].v,age);expected.y-=age*age*4;
    assert.ok(sample.position.distanceTo(expected)<1e-9);
    assert.equal(sample.opacity,1-age/p[j].life);assert.equal(sample.size,p[j].size*(1+age*.4));
   }
   assert.equal(sampleAircraftParticle(p[j],12+p[j].life+.001).visible,false);
  }
  assert.deepEqual(e.position.toArray(),[10,2400,-20]);
 }
});
test('source has no live damage smoke, loop/end rings or airborne muzzle flashes',()=>{
 for(const type of ['shot','damage','loop','end','spawn','reload-start','reload-complete'] as const)
  assert.deepEqual(aircraftEventParticles({id:1,type,position:new Vector3(),owner:1},0),[]);
 assert.equal(AIRCRAFT_EFFECT_CAPACITY,240);
 assert.match(AIRCRAFT_PARTICLE_VERTEX,/size\*450/);assert.match(AIRCRAFT_PARTICLE_FRAGMENT,/pow\(1\.-d,1\.7\)\*\.8\*vAlpha/);
});
test('source frame fixture: wreck half-speed, y=origin+vy*t-4.9t², local Z then X spin, five seconds',()=>{
 const origin=new Vector3(2,2400,6),rotation=new Quaternion().setFromEuler(new Euler(.2,.3,-.4,'YXZ'));
 const velocity=new Vector3(0,0,-1).applyQuaternion(rotation).multiplyScalar(55);
 for(const t of [0,.5,1,2.4,4.99,5]){
  const pose=aircraftWreckPose(origin,rotation,velocity,t),expect=origin.clone().addScaledVector(velocity,t);expect.y-=4.9*t*t;
  assert.ok(pose.position.distanceTo(expect)<1e-9);
  const z=new Quaternion(0,0,Math.sin(.65*t/2),Math.cos(.65*t/2));
  const x=new Quaternion(Math.sin(.16*t/2),0,0,Math.cos(.16*t/2));
  assert.ok(pose.quaternion.angleTo(rotation.clone().multiply(z).multiply(x))<1e-7);
  assert.equal(pose.visible,t<5);
 }
});
test('source particle capacity, one emission per event, pause/no-age state and new-session clear',()=>{
 const scene=Object.assign(Object.create(FlightScene.prototype),{particles:[],seenEventIds:new Set(),eventOrder:[],visualTime:2,
  particlePositions:new Float32Array(720),particleColors:new Float32Array(720),particleOpacity:new Float32Array(240),particleSizes:new Float32Array(240),particleGeometry:new BufferGeometry()});
 for(const [name,n]of [['position',3],['color',3],['opacity',1],['size',1]] as const)scene.particleGeometry.setAttribute(name,new BufferAttribute(new Float32Array(240*n),n));
 const events=Array.from({length:20},(_,i)=>({id:i+1,type:'kill',position:new Vector3(),owner:1}));
 scene.collectEvents(events);assert.equal(scene.particles.length,240);scene.collectEvents(events);assert.equal(scene.particles.length,240);
 scene.updateEffects(1);assert.equal(scene.particleGeometry.drawRange.count,240);assert.equal(scene.particleOpacity[0],1);
 scene.visualTime=4.401;scene.updateEffects(0);assert.equal(scene.particleGeometry.drawRange.count,0);
});
test('integrated wreck preserves source origin, half-speed and pause/result lifecycle without gameplay score changes',()=>{
 const s=createGame(),enemy=s.enemies[0];enemy.position.copy(s.player.position);startGame(s);stepGame(s,idle,1/60);
 assert.equal(s.endReason,'collision');assert.equal(s.score,2000);assert.equal(s.wrecks.length,2);
 for(const w of s.wrecks){
  const origin=w.position.clone(),q=w.quaternion.clone(),v=w.velocity.clone();assert.ok(Math.abs(v.length()-w.speed*.5)<1e-8);
  const beforeScore=s.score;for(let i=0;i<60;i++)stepGame(s,idle,1/60);
  const expected=aircraftWreckPose(origin,q,v,1);assert.ok(w.position.distanceTo(expected.position)<1e-7);assert.equal(s.score,beforeScore);
  break;
 }
 const active=createGame();active.enemies[0].health=0;startGame(active);pauseGame(active);const t=active.elapsed;stepGame(active,idle,1);assert.equal(active.elapsed,t);resumeGame(active);
});

test('new state identity clears cosmetics even with identical seed/elapsed/phase',()=>{
 const state=createGame(4),second=createGame(4),removed:any[]=[];
 const scene=Object.assign(Object.create(FlightScene.prototype),{activeGame:state,seenEventIds:new Set([1]),eventOrder:[1],particles:[{}],visualTime:4,
  playerVisual:{propeller:{rotation:{z:9}}},wreckVisuals:new Map(),particleGeometry:new BufferGeometry(),enemyVisuals:new Map([[2,{root:{id:2}}]]),scene:{remove:(x:any)=>removed.push(x)}});
 scene.beginSession(second);assert.equal(scene.activeGame,second);assert.equal(scene.particles.length,0);assert.equal(scene.seenEventIds.size,0);assert.equal(scene.enemyVisuals.size,0);assert.equal(removed.length,1);assert.equal(scene.playerVisual.propeller.rotation.z,0);
});

test('incoming-hit and player-destruction SE routing matches the source ownership/target contract',async()=>{
 const {aircraftSoundAudience}=await import('../src/aircraft-vfx');
 const e={id:1,position:new Vector3(),owner:2};
 assert.equal(aircraftSoundAudience({...e,type:'shot'},1),null);
 assert.equal(aircraftSoundAudience({...e,type:'hit',target:1},1),true);
 assert.equal(aircraftSoundAudience({...e,type:'damage',owner:1,target:1},1),true);
 assert.equal(aircraftSoundAudience({...e,type:'kill',target:1},1),false);
 assert.equal(aircraftSoundAudience({...e,type:'kill',owner:1,target:2},1),true);
 const s=createGame();s.enemies[0].position.copy(s.player.position);startGame(s);stepGame(s,idle,1/60);
 const kills=s.events.filter(e=>e.type==='kill');assert.equal(kills.length,2);assert.equal(kills.filter(e=>e.target===s.player.id).length,1);
});
