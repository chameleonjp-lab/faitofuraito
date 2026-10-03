import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Vector3} from 'three';
import {AIRCRAFT_BASE_DAMAGE, AIRCRAFT_HEALTH, aircraftDamageMultiplier} from '../src/aircraft-damage';
import {createGame,startGame,stepGame} from '../src/simulation';
const idle={turn:0,climb:0,fire:false,loop:false};
for(const kind of ['mg','cannon'] as const)test(`${kind}: four exact bands, adjacent boundaries, invalid distances`,()=>{
 const values=kind==='mg'?[1,.75,.5,.25]:[1,.9,.8,.7];
 for(const [distance,index] of [[0,0],[199.999,0],[200,1],[499.999,1],[500,2],[799.999,2],[800,3],[100000,3]])assert.equal(aircraftDamageMultiplier(kind,distance),values[index]);
 for(const distance of [-1,NaN,Infinity,-Infinity])assert.throws(()=>aircraftDamageMultiplier(kind,distance),RangeError);
});
for(const kind of ['mg','cannon'] as const)test(`${kind}: damage uses cumulative path at swept impact, not the full step or current shooter range`,()=>{
 for(const [history,multiplier] of [[190,1],[194,kind==='mg'?.75:.9],[500,kind==='mg'?.5:.8],[800,kind==='mg'?.25:.7]]){
  const s=createGame();s.enemies[0].position.set(10000,10000,10000);s.player.health=s.player.maxHealth=AIRCRAFT_HEALTH;
  const p=s.player.position.clone().add(new Vector3(0,0,12)),origin=p.clone(),base=AIRCRAFT_BASE_DAMAGE.enemy[kind];
  s.bullets=[{id:100,owner:s.enemies[0].id,position:p,previous:p.clone(),velocity:new Vector3(0,0,-1000),life:1,damage:base,kind,distanceTravelled:history}];
  startGame(s);stepGame(s,idle,1/60);
  const hit=s.events.find(e=>e.type==='hit');assert.ok(hit);
  // Impact is ~6.63m into the 16.67m step:190 remains near;194 enters second band.
  const travelled=origin.distanceTo(hit.position);assert.ok(travelled>6&&travelled<7);
  assert.ok(Math.abs(s.player.health-(AIRCRAFT_HEALTH-base*multiplier))<1e-9);
  assert.ok(Math.abs(s.damageTaken-base*multiplier)<1e-9);
 }
});
test('free flight accumulates actual bullet travel and never reapplies attenuation per tick',()=>{
 const s=createGame();s.enemies=[];const p=new Vector3(10000,2400,0);
 s.bullets=[{id:100,owner:s.player.id,position:p,previous:p.clone(),velocity:new Vector3(300,400,0),life:1.5,damage:4,kind:'mg',distanceTravelled:0}];
 startGame(s);for(let i=0;i<30;i++)stepGame(s,idle,1/60);
 assert.ok(Math.abs(s.bullets[0].distanceTravelled!-250)<1e-7);assert.equal(s.bullets[0].damage,4);
});
test('actual gun volleys use the shared base damage and paired five/fifteen tick player cadence',()=>{
 const s=createGame();s.enemies=[];startGame(s);
 const counts={mg:0,cannon:0};
 for(let tick=0;tick<60;tick++){
  const before=new Set(s.bullets.map(b=>b.id));stepGame(s,{...idle,fire:true},1/60);
  for(const b of s.bullets.filter(b=>!before.has(b.id))){counts[b.kind]++;assert.equal(b.damage,AIRCRAFT_BASE_DAMAGE.player[b.kind]);}
 }
 assert.deepEqual(counts,{mg:24,cannon:8});
 assert.equal(counts.mg*4+counts.cannon*20,256);
});
