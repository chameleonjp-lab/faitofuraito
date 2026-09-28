import type { Quaternion, Vector3 } from 'three';
export interface Aircraft { id:number; position:Vector3; previous:Vector3; quaternion:Quaternion; yaw:number; pitch:number; bank:number; speed:number; health:number; mg:number; cannon:number; fireClock:number; cannonClock:number; loopProgress:number; loopCooldown:number; mode:'pursue'|'evade'|'flee'; age:number; }
export interface Bullet { id:number; owner:number; position:Vector3; previous:Vector3; velocity:Vector3; life:number; damage:number; kind:'mg'|'cannon'; }
export interface GameEvent { id:number; type:'shot'|'hit'|'kill'|'damage'|'loop'|'end'; position:Vector3; owner:number; }
export interface FlightInput { turn:number; climb:number; fire:boolean; loop:boolean; accelerate?:boolean; brake?:boolean; }
export interface Wreck { id:number; position:Vector3; previous:Vector3; quaternion:Quaternion; velocity:Vector3; age:number; }
export interface GameState { phase:'ready'|'playing'|'paused'|'ended'; player:Aircraft; enemies:Aircraft[]; wrecks:Wreck[]; bullets:Bullet[]; events:GameEvent[]; elapsed:number; kills:number; shots:number; hits:number; loops:number; damageTaken:number; score:number; endReason:'time'|'shot-down'|'ammo'|null; seed:number; }
