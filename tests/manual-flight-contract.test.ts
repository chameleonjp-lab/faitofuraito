import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { createGame, startGame, stepGame, pauseGame, resumeGame } from '../src/simulation';
import { getFlightCameraPose } from '../src/flight-view';
import { getFlightAssist, autoFireTarget } from '../src/flight-assist';
import { updateQuaternion, forwardOf } from '../src/flight';
import { createFlightTargetLock } from '../src/flight-target';

const neutral={turn:0,climb:0,fire:false,loop:false,viewAspect:402/874};
function fixture(mode:'easy'|'normal', x:number, z:number){
 const s=createGame(73,mode);startGame(s);s.player.position.set(0,1500,0);s.player.previous.copy(s.player.position);
 s.enemies=s.enemies.slice(0,1);const p=new Vector3(),q=new Quaternion();getFlightCameraPose(s.player,mode,p,q);
 s.enemies[0].position.set(x,0,z).applyQuaternion(q).add(p);s.enemies[0].previous.copy(s.enemies[0].position);return s;
}
for(const mode of ['easy','normal'] as const){
 test(`${mode}: enemy layout never changes flight, gain or camera under the same input`,()=>{
  for(const raw of [neutral,{...neutral,turn:.2,steeringActive:true},{...neutral,climb:.2,steeringActive:true},{...neutral,turn:.1,climb:.15,fire:true,steeringActive:true}]){
   const a=fixture(mode,105,-500),b=fixture(mode,0,500);
   assert.equal(getFlightAssist(b.player,b.enemies,raw,mode).responseMultiplier,1);
   for(let i=0;i<12;i++){
    if(i===6){pauseGame(a);pauseGame(b);resumeGame(a);resumeGame(b);}
    stepGame(a,raw,1/60);stepGame(b,raw,1/60);
    assert.ok(a.player.position.distanceTo(b.player.position)<.001);
    assert.ok(a.player.quaternion.angleTo(b.player.quaternion)<Math.PI/180*.001);
    const ap=new Vector3(),aq=new Quaternion(),bp=new Vector3(),bq=new Quaternion();getFlightCameraPose(a.player,mode,ap,aq);getFlightCameraPose(b.player,mode,bp,bq);
    assert.ok(ap.distanceTo(bp)<.001);assert.ok(aq.angleTo(bq)<Math.PI/180*.001);
   }
  }
 });
 test(`${mode}: held centered steering preserves pitch until release`,()=>{
  const s=fixture(mode,0,500);s.enemies=[];s.player.pitch=20*Math.PI/180;updateQuaternion(s.player);
  for(let i=0;i<12;i++)stepGame(s,{...neutral,steeringActive:true},1/60);
  assert.ok(Math.abs(s.player.pitch-20*Math.PI/180)<1e-12);
  stepGame(s,neutral,1/60);assert.ok(s.player.pitch<20*Math.PI/180);assert.ok(s.player.pitch>19*Math.PI/180);
 });
 test(`${mode}: both physical gun pairs launch along the current aircraft nose`,()=>{
  const s=fixture(mode,20,-500);s.enemies[0].position.copy(s.player.position).add(new Vector3(20,0,-500));s.enemies[0].previous.copy(s.enemies[0].position);
  stepGame(s,{...neutral,fire:true},1/60);const shots=s.bullets.filter(b=>b.owner===s.player.id);assert.equal(shots.length,4);
  for(const b of shots)assert.ok(b.velocity.angleTo(forwardOf(s.player))<Math.PI/180*.001,`${b.kind} must stay on bore`);
 });
}
test('Easy trigger uses the current circle and viewport rather than an old lock',()=>{
 const s=fixture('easy',0,-500),e=s.enemies[0],lock=createFlightTargetLock();lock.key='stale';
 assert.equal(autoFireTarget(s.player,[e],'easy',402/874,lock),e);
 e.health=0;assert.equal(autoFireTarget(s.player,[e],'easy',402/874,lock),null);
});
