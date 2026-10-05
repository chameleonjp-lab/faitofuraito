import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advanceThrottle, type FlightController } from '../src/flight';
import { clampThrottleAxis, throttleAxisFromRaw, throttleAxisFromClientY, combineThrottleAxes, resolveThrottleAxis } from '../src/throttle-lever';
import type { GameMode, FlightInput } from '../src/types';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/throttle-lever-v1.json',import.meta.url),'utf8'));
const equal=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-12, `${actual} != ${expected}`);
test('every shared rate-lever fixture is connected to actual throttle integration',()=>{
 for(const c of fixture.axis) equal(throttleAxisFromRaw(c.raw),c.expected);
 for(const c of fixture.pointer) equal(throttleAxisFromClientY(c.y,c.top,c.bottom),c.expected);
 for(const c of fixture.combine) equal(combineThrottleAxes(c.pointer,c.accelerate,c.brake,c.focused),c.expected);
 for(const c of fixture.advance){const meta={playerTargetSpeed:c.start} as FlightController;equal(advanceThrottle(meta,{turn:0,climb:0,fire:false,loop:false,throttle:c.axis},c.mode as GameMode,c.dt),c.expected);}
});
test('invalid axes fail neutral, boundaries are continuous, and explicit analog zero overrides legacy input',()=>{
 for(const bad of [NaN,Infinity,-Infinity]){equal(clampThrottleAxis(bad),0);equal(throttleAxisFromRaw(bad),0);equal(throttleAxisFromClientY(bad,100,200),0);equal(resolveThrottleAxis({throttle:bad,accelerate:true}),0);}
 equal(throttleAxisFromClientY(100,200,100),0);equal(throttleAxisFromClientY(100,NaN,200),0);
 for(const sign of [-1,1]){equal(throttleAxisFromRaw(sign*.08),0);assert.ok(Math.abs(throttleAxisFromRaw(sign*(.08+1e-8)))<1e-7);}
 equal(resolveThrottleAxis({throttle:0,accelerate:true}),0);equal(resolveThrottleAxis({accelerate:true}),1);equal(resolveThrottleAxis({brake:true}),-1);equal(resolveThrottleAxis({accelerate:true,brake:true}),0);
});
test('release holds adjusted target, maximum lever equals legacy keys, Easy ignores the lever',()=>{
 const input={turn:0,climb:0,fire:false,loop:false} as FlightInput;
 const lever={playerTargetSpeed:110} as FlightController, legacy={playerTargetSpeed:110} as FlightController;
 for(let tick=0;tick<60;tick++){advanceThrottle(lever,{...input,throttle:1},'normal',1/60);advanceThrottle(legacy,{...input,accelerate:true},'normal',1/60);}
 equal(lever.playerTargetSpeed,legacy.playerTargetSpeed);equal(lever.playerTargetSpeed,128);
 for(let tick=0;tick<60;tick++)advanceThrottle(lever,{...input,throttle:0},'normal',1/60);equal(lever.playerTargetSpeed,128);
 const easy={playerTargetSpeed:110} as FlightController;advanceThrottle(easy,{...input,throttle:1,accelerate:true},'easy',1);equal(easy.playerTargetSpeed,110);
});

import { createGame, startGame, stepGame } from '../src/simulation';
test('the live stepGame path applies fractional throttle, explicit neutral and unchanged Easy input',()=>{
 const run=(input:Partial<FlightInput>,mode:GameMode='normal')=>{const state=createGame(123,mode);startGame(state);for(let i=0;i<60;i++)stepGame(state,{turn:0,climb:0,fire:false,loop:false,...input},1/60);return state.player.speed;};
 const zero=run({throttle:0}), half=run({throttle:.5}), full=run({throttle:1});
 assert.ok(half>zero+1);assert.ok(half<full-1);equal(full,run({accelerate:true}));equal(zero,run({throttle:0,accelerate:true}));
 equal(run({throttle:1},'easy'),run({throttle:0},'easy'));
});
