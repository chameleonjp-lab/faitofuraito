import { Color, Quaternion, Vector3 } from 'three';
import type { GameEvent } from './types';

/** Aircraft-only presentation contract from Kaisen c63bff8 src/scene.ts. */
export const AIRCRAFT_EFFECT_CAPACITY = 240;
export const AIRCRAFT_WRECK_LIFETIME = 5;
export interface AircraftParticle { p: Vector3; v: Vector3; born: number; life: number; color: Color; size: number }
export function aircraftEventParticles(event: GameEvent, time: number): AircraftParticle[] {
  if (event.type !== 'hit' && event.type !== 'kill') return [];
  const kill = event.type === 'kill';
  return Array.from({length: kill ? 18 : 3}, (_, j) => {
    const seed = event.id * 31 + j * 17, angle = seed * 2.399963, radius = kill ? 18 : 5;
    return { p:event.position.clone(), v:new Vector3(Math.cos(angle)*radius,6+seed%13,Math.sin(angle)*radius),
      born:time,life:kill?2.4:.7,color:new Color(kill&&j%2===0?0x354047:j%3===0?0xffd993:0xed641d),size:kill?28:8 };
  });
}
export function sampleAircraftParticle(p:AircraftParticle,time:number){
  const age=time-p.born,position=p.p.clone().addScaledVector(p.v,age);position.y-=age*age*4;
  return {position,opacity:1-age/p.life,size:p.size*(1+age*.4),visible:age>=0&&age<p.life};
}
export function aircraftWreckPose(position:Vector3,rotation:Quaternion,velocity:Vector3,age:number){
  const p=position.clone().addScaledVector(velocity,age);p.y-=age*age*4.9;
  const q=rotation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),age*.65))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),age*.16));
  return {position:p,quaternion:q,visible:age<AIRCRAFT_WRECK_LIFETIME&&p.y>=0};
}
export const AIRCRAFT_PARTICLE_VERTEX = 'attribute float size;attribute float opacity;varying vec3 vColor;varying float vAlpha;void main(){vColor=color;vAlpha=opacity;vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=size<0.?-size:clamp(size*450./max(1.,-p.z),1.,80.);gl_Position=projectionMatrix*p;}';
export const AIRCRAFT_PARTICLE_FRAGMENT = 'varying vec3 vColor;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;gl_FragColor=vec4(vColor,pow(1.-d,1.7)*.8*vAlpha);}';

/** Match Kaisen's event routing, including an incoming hit relating to the player. */
export function aircraftSoundAudience(event:GameEvent,playerId:number):boolean|null{
  if(event.type==='kill')return event.target!==playerId;
  return event.owner===playerId||event.target===playerId?true:null;
}
