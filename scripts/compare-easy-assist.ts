import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory=resolve(process.argv[2]??'src');
const {createGame,startGame,stepGame}=await import(pathToFileURL(resolve(directory,'simulation.ts')).href);
const {EASY_SHOT_ASSIST_FRACTION,EASY_SHOT_ASSIST_MAX_ANGLE}=await import(pathToFileURL(resolve(directory,'flight-assist.ts')).href);
const neutral={turn:0,climb:0,fire:false,loop:false};
const rows:unknown[]=[];
function measure(label:string,seed:number,aspect:number,mode:'easy'|'normal',duration:number,position?:[number,number]){
 const s=createGame(seed,mode),hash=createHash('sha256');
 const initialEnemy=s.enemies[0],initialHealth=initialEnemy.health;
 if(position){s.enemies[0].position.set(position[0],s.player.position.y,-position[1]);s.enemies[0].previous.copy(s.enemies[0].position);}
 startGame(s);
 let tick=0;
 while(s.phase==='playing'&&tick<duration*60){
  const input={...neutral,turn:label==='fixed'&&tick<20?.6:0,fire:mode==='normal',viewAspect:aspect};
  stepGame(s,input,1/60);tick++;
  hash.update(JSON.stringify([s.player.position.toArray(),s.player.quaternion.toArray(),s.player.speed]));
 }
 rows.push({label,seed,aspect,position,mode,tick,elapsed:s.elapsed,shots:s.shots,hits:s.hits,kills:s.kills,projectileKills:s.kills-Number(s.endReason==='collision'),enemyDamage:position?initialHealth-initialEnemy.health:undefined,end:s.endReason,trajectory:hash.digest('hex')});
}
for(const aspect of [393/852,852/393]){
 for(const seed of [1,7,42,81,92,2026]){measure('idle',seed,aspect,'easy',300);measure('normal',seed,aspect,'normal',120);}
 for(const x of [60,90,120])for(const z of [300,450,650])measure('fixed',42,aspect,'easy',4,[x,z]);
}
console.log(JSON.stringify({directory,fraction:EASY_SHOT_ASSIST_FRACTION,cap:EASY_SHOT_ASSIST_MAX_ANGLE,rows},null,2));
