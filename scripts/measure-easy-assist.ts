import { createGame, startGame, stepGame } from '../src/simulation';
import { Vector3 } from 'three';
const manual=process.argv.includes('--manual');
const rows=[];
for(const aspect of [393/852,852/393]) for(const seed of [1,7,42,81,92,2026]){
 const state=createGame(seed,'easy'); startGame(state);
 while(state.phase==='playing' && state.elapsed<300){
  let turn=0,climb=0;
  if(manual){
   const enemy=state.enemies.filter(e=>e.health>0).sort((a,b)=>a.position.distanceToSquared(state.player.position)-b.position.distanceToSquared(state.player.position))[0];
   if(enemy){
    // A scripted skilled pilot with exact state, not a human usability result.
    const relative=enemy.position.clone().sub(state.player.position);
    const lead=relative.addScaledVector(new Vector3(0,0,-1).applyQuaternion(enemy.quaternion).multiplyScalar(enemy.speed),relative.length()/850).normalize();
    const yaw=Math.atan2(-lead.x,-lead.z), pitch=Math.asin(lead.y);
    const error=Math.atan2(Math.sin(yaw-state.player.yaw),Math.cos(yaw-state.player.yaw));
    turn=Math.max(-1,Math.min(1,-error/.18));climb=Math.max(-1,Math.min(1,pitch/.95));
   }
  }
  stepGame(state,{turn,climb,fire:false,loop:false,viewAspect:aspect},1/60);
 }
 rows.push({seed,aspect,elapsed:state.elapsed,kills:state.kills,hits:state.hits,shots:state.shots,health:state.player.health,end:state.endReason});
}
console.log(JSON.stringify(rows,null,2));
