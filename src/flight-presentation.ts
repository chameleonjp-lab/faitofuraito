import {Quaternion,Vector3} from 'three';
import {normalizeAngle} from './flight';
import type {Aircraft,GameState} from './types';

type Pose={position:Vector3;quaternion:Quaternion;pitch:number;yaw:number;bank:number;health:number};
/** Presentation owns copies only. Combat, time and scoring always use the fixed state. */
export class FlightPresentation {
 private state:GameState|null=null;
 private elapsed=-1;
 private poses=new Map<number,Pose>();
 capture(state:GameState):void {
  if(this.state!==state)this.poses.clear();this.state=state;this.elapsed=state.elapsed;
  const live=new Set<number>();
  for(const aircraft of [state.player,...state.enemies]){
   live.add(aircraft.id);this.poses.set(aircraft.id,{position:aircraft.position.clone(),quaternion:aircraft.quaternion.clone(),pitch:aircraft.pitch,yaw:aircraft.yaw,bank:aircraft.bank,health:aircraft.health});
  }
  for(const id of this.poses.keys())if(!live.has(id))this.poses.delete(id);
 }
 sample(state:GameState,alpha:number):GameState {
  if(state.phase!=='playing'){this.state=null;return state;}
  if(this.state!==state||Math.abs(state.elapsed-this.elapsed-1/60)>1e-8)return state;
  const fraction=Number.isFinite(alpha)?Math.max(0,Math.min(1,alpha)):1;
  const pose=(aircraft:Aircraft):Aircraft=>{
   const previous=this.poses.get(aircraft.id);if(!previous||previous.health<=0||aircraft.health<=0)return aircraft;
   return {...aircraft,position:previous.position.clone().lerp(aircraft.position,fraction),quaternion:previous.quaternion.clone().slerp(aircraft.quaternion,fraction),
    pitch:previous.pitch+normalizeAngle(aircraft.pitch-previous.pitch)*fraction,yaw:previous.yaw+normalizeAngle(aircraft.yaw-previous.yaw)*fraction,bank:previous.bank+normalizeAngle(aircraft.bank-previous.bank)*fraction};
  };
  return {...state,player:pose(state.player),enemies:state.enemies.map(pose),
   bullets:state.bullets.map(b=>({...b,position:b.previous.clone().lerp(b.position,fraction)})),elapsed:this.elapsed+fraction/60};
 }
}
