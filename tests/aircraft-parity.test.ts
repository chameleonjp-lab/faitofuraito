import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { aircraftDamageMultiplier, AIRCRAFT_HEALTH } from '../src/aircraft-damage';
import { createGame,startGame,stepGame,pauseGame,resumeGame,MG_AMMO,CANNON_AMMO,PLAYER_RELOAD_TICKS,calculateScore } from '../src/simulation';
const idle={turn:0,climb:0,fire:false,loop:false};
test('both modes share aircraft HP, magazines and reload with no allies or fleet',()=>{
 for(const mode of ['easy','normal'] as const){
  const s=createGame(8,mode);assert.equal(s.player.maxHealth,AIRCRAFT_HEALTH);assert.equal(s.enemies[0].maxHealth,AIRCRAFT_HEALTH);
  assert.equal(s.player.mg,288);assert.equal(s.player.cannon,96);assert.equal('allies' in s,false);assert.equal('ships' in s,false);
  s.enemies=[];s.player.reloadTicksRemaining=PLAYER_RELOAD_TICKS;s.player.mg=s.player.cannon=0;startGame(s);
  pauseGame(s);stepGame(s,idle,1);assert.equal(s.player.reloadTicksRemaining,360);resumeGame(s);
  for(let i=0;i<360;i++)stepGame(s,idle,1/60);
  assert.equal(s.player.reloadTicksRemaining,0);assert.equal(s.player.mg,MG_AMMO);assert.equal(s.player.cannon,CANNON_AMMO);
  assert.equal(s.events.filter(e=>e.type==='reload-complete').length,1);stepGame(s,idle,1/60);
  assert.equal(s.events.filter(e=>e.type==='reload-complete').length,0);
 }
});
test('ram scores an ordinary kill once, preserving original non-contact score formula',()=>{
 const s=createGame();s.enemies[0].position.copy(s.player.position);startGame(s);stepGame(s,idle,1/60);
 assert.equal(s.score,calculateScore(1,0,0));assert.equal(s.contactKills,0);assert.equal(s.kills,1);
 stepGame(s,idle,1/60);assert.equal(s.kills,1);assert.equal(s.score,2000);
});
test('AI same-team aircraft are protected from enemy rounds in both modes',()=>{
 for(const mode of ['easy','normal'] as const){
  const s=createGame(1,mode),e=s.enemies[0];s.player.position.x=5000;e.position.set(0,2400,0);e.previous.copy(e.position);
  const p=new Vector3(0,2400,12);s.bullets=[{id:100,owner:999,position:p,previous:p.clone(),velocity:new Vector3(0,0,-1000),life:1,damage:999,kind:'mg'}];
  startGame(s);stepGame(s,idle,1/60);assert.equal(e.health,e.maxHealth);
 }
});
