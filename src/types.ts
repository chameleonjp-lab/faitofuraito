import type { Quaternion, Vector3 } from 'three';
export interface Aircraft { id:number; position:Vector3; previous:Vector3; quaternion:Quaternion; yaw:number; pitch:number; bank:number; speed:number; health:number; maxHealth:number; reloadTicksRemaining:number; mg:number; cannon:number; fireClock:number; cannonClock:number; loopProgress:number; loopCooldown:number; mode:'pursue'|'evade'|'flee'; age:number; aiPhase:'approach'|'attack'|'extend'; aiPhaseTime:number; aiWaypoint:Vector3; aiTurn:number; aiClimb:number; aiFire:boolean; }
export interface Bullet { id:number; owner:number; position:Vector3; previous:Vector3; velocity:Vector3; life:number; damage:number; distanceTravelled?:number; kind:'mg'|'cannon'; }
export type GameMode = 'normal' | 'easy';
export interface GameEvent { id:number; type:'shot'|'hit'|'kill'|'damage'|'loop'|'end'|'spawn'|'reload-start'|'reload-complete'; position:Vector3; owner:number; target?:number; }
export interface FlightInput { turn:number; climb:number; fire:boolean; loop:boolean; throttle?:number; accelerate?:boolean; brake?:boolean; viewAspect?:number; steeringRevision?:number; }
export interface Wreck { id:number; sourceId:number; player:boolean; speed:number; position:Vector3; previous:Vector3; quaternion:Quaternion; velocity:Vector3; age:number; }
export interface GameState { phase:'ready'|'playing'|'paused'|'ended'; mode:GameMode; player:Aircraft; enemies:Aircraft[]; wrecks:Wreck[]; bullets:Bullet[]; events:GameEvent[]; elapsed:number; kills:number; contactKills:number; shots:number; hits:number; loops:number; damageTaken:number; score:number; endReason:'time'|'shot-down'|'collision'|'ammo'|'low-altitude'|null; lowAltitudeRemaining:number|null; seed:number; }

