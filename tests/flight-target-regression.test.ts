import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3, Quaternion } from 'three';
import { getFlightAssist, autoFireTarget } from '../src/flight-assist';
import { FLIGHT_FOV, getFlightCameraPose } from '../src/flight-view';
import { createFlightTargetLock, smoothFlightAssistance, clearFlightAssistance } from '../src/flight-target';

const numeric = false, callback = false;
const input = { turn: 0, climb: 0, fire: false, loop: false, viewAspect: 393 / 852 };
function player(): any { return {id:1, kind:'aircraft', team:'friendly', health:80, position:numeric?{x:0,y:300,z:0}:new Vector3(0,300,0),
  previous:new Vector3(0,300,0),quaternion:numeric?{x:0,y:0,z:0,w:1}:new Quaternion(), pitch:0,yaw:0,bank:0,speed:110,loopProgress:0,loopCooldown:0}; }
function target(p:any, id:number, x:number, y:number, depth:number, extra:any = {}): any {
  const position = new Vector3(), rotation = new Quaternion();
  if(numeric) { const c=getFlightCameraPose(p,'easy'); position.set(c.position.x,c.position.y,c.position.z);rotation.set(c.rotation.x,c.rotation.y,c.rotation.z,c.rotation.w); }
  else getFlightCameraPose(p,'easy',position,rotation);
  const tan=Math.tan(FLIGHT_FOV*Math.PI/360), point=new Vector3(x*depth*tan*input.viewAspect,y*depth*tan,-depth).applyQuaternion(rotation).add(position);
  return {id,kind:'aircraft',team:'enemy',health:80,hp:80,generation:1,identityGeneration:1,position:numeric?{x:point.x,y:point.y,z:point.z}:point,
    velocity:numeric?{x:0,y:0,z:0}:new Vector3(),quaternion:numeric?{x:0,y:0,z:0,w:1}:new Quaternion(),speed:0,aimHeight:0,...extra};
}
function assist(p:any, ts:any[], i:any=input, lock:any=createFlightTargetLock()) {
  return callback ? getFlightAssist(p,ts,i,'easy',undefined,lock) : getFlightAssist(p,ts,i,'easy',lock);
}
function fire(p:any,ts:any[],lock:any) { return callback ? autoFireTarget(p,ts,'easy',input.viewAspect,undefined,lock) : autoFireTarget(p,ts,'easy',input.viewAspect,lock); }
test('circle A wins over closer off-circle B in either array order',()=>{
  for(const reversed of [false,true]){ const p=player(),a=target(p,2,0,0,950),b=target(p,3,.8,.55,400),lock=createFlightTargetLock();
    const ts=reversed?[b,a]:[a,b],r=assist(p,ts,input,lock);assert.equal(r.turn,0);assert.equal(r.climb,0);assert.equal(fire(p,ts,lock)?.id,2); }
});
test('equal rank has a deterministic ID tie break',()=>{
  for(const reversed of [false,true]){ const p=player(),a=target(p,2,.1,0,500),b=target(p,3,.1,0,500),lock=createFlightTargetLock();
    const ts=reversed?[b,a]:[a,b];assist(p,ts,input,lock);assert.equal(fire(p,ts,lock)?.id,2); }
});
test('steering owner suppresses target pull even on a small movement or circle promotion',()=>{
  const p=player(),lock=createFlightTargetLock(),a=target(p,2,-.8,-.55,600),b=target(p,3,0,0,500);
  assist(p,[a],input,lock);
  for(const ts of [[a],[a,b]]) { const r=assist(p,ts,{...input,turn:.1,climb:.02,steeringActive:true},lock);assert.equal(r.turn,.1);assert.equal(r.climb,.02); }
});
test('strong reverse manual input remains intact',()=>{
  const p=player(),r=assist(p,[target(p,2,.8,.55,500)],{...input,turn:-.6,climb:-.7});assert.equal(r.turn,-.6);assert.equal(r.climb,-.7);
});
test('Normal fire flag does not change steering requests',()=>{
  const p=player(),ts=[target(p,2,.8,.55,500)],i={...input,turn:.2,climb:.1};
  assert.deepEqual(getFlightAssist(p,ts,i,'normal'),getFlightAssist(p,ts,{...i,fire:true},'normal'));
});


// Fire selection is independent of a previous steering lock and re-evaluates live candidates.
test('a lost/dead target immediately yields to a current circle target and empty selection clears lock',()=>{
 const p=player(),a=target(p,2,0,0,500),b=target(p,3,.1,0,500),lock=createFlightTargetLock();
 assert.equal(fire(p,[a,b],lock)?.id,2);a.health=0;assert.equal(fire(p,[a,b],lock)?.id,3);
 b.position=target(p,3,2,0,500).position;assert.equal(fire(p,[a,b],lock),null);assert.equal(lock.key,null);
});
test('target generation changes are identified by the trigger without changing steering',()=>{
 const p=player(),a=target(p,2,0,0,500),lock=createFlightTargetLock();fire(p,[a],lock);const first=lock.key;
 a.generation=2;a.identityGeneration=2;assert.equal(fire(p,[a],lock)?.id,2);assert.notEqual(lock.key,first);
 assert.deepEqual(assist(p,[a],input,lock),{turn:0,climb:0,responseMultiplier:1,hasVisibleTarget:false});
});
