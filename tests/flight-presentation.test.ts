import test from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {createGame,startGame,stepGame,pauseGame,resumeGame} from '../src/simulation';
import {getFlightCameraPose} from '../src/flight-view';
const neutral={turn:0,climb:0,fire:false,loop:false,steeringActive:true};
async function implementation(){const module=await import('../src/flight-presentation').catch(()=>undefined);assert.ok(module,'fixed-pose presentation must be implemented');return module;}
for(const mode of ['easy','normal'] as const)test(`${mode}: 120Hz presentation never repeats a climbing view and never changes fixed outcomes`,async()=>{
 const {FlightPresentation}=await implementation(),presentation=new FlightPresentation(),s=createGame(73,mode),baseline=createGame(73,mode);startGame(s);startGame(baseline);s.enemies=[];baseline.enemies=[];
 let accumulator=0,previous:Vector3|undefined,repeated=0;
 for(let frame=0;frame<60;frame++){
  accumulator+=1/120;while(accumulator+1e-12>=1/60){presentation.capture(s);stepGame(s,{...neutral,climb:.45},1/60);stepGame(baseline,{...neutral,climb:.45},1/60);accumulator-=1/60;}
  const render=presentation.sample(s,accumulator*60),p=new Vector3(),q=new Quaternion();getFlightCameraPose(render.player,mode,p,q);const forward=new Vector3(0,0,-1).applyQuaternion(q);
  if(frame>=12&&previous&&previous.distanceTo(forward)<1e-12)repeated++;previous=forward;
  assert.deepEqual(s.player.position.toArray(),baseline.player.position.toArray());assert.equal(s.elapsed,baseline.elapsed);
 }
 assert.equal(repeated,0);
});
test('presentation samples all aircraft poses at one fraction and resets after pause or replacement',async()=>{
 const {FlightPresentation}=await implementation(),p=new FlightPresentation(),s=createGame(73,'easy');startGame(s);const before=s.player.position.clone(),enemy=s.enemies[0],enemyBefore=enemy.position.clone();
 p.capture(s);stepGame(s,{...neutral,turn:.2,climb:.45},1/60);const snapshot=p.sample(s,.5);
 assert.ok(snapshot.player.position.distanceTo(before.clone().lerp(s.player.position,.5))<1e-12);
 assert.ok(snapshot.enemies[0].position.distanceTo(enemyBefore.clone().lerp(enemy.position,.5))<1e-12);
 assert.ok(snapshot.player.quaternion.angleTo(s.player.quaternion)>1e-5);assert.ok(snapshot.player.pitch<s.player.pitch);assert.ok(snapshot.player.bank<s.player.bank);
 assert.notEqual(snapshot.player.position,s.player.position);pauseGame(s);assert.equal(p.sample(s,.3),s);resumeGame(s);assert.equal(p.sample(s,.3),s);
 const replacement=createGame(74,'normal');startGame(replacement);assert.equal(p.sample(replacement,.5),replacement);
});
