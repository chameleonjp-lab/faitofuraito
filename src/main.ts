import './style.css';
import { FlightScene } from './scene';
import { SphereRadar } from './radar';
import { FlightControls } from './input';
import { ControlSettings } from './control-settings';
import { FlightAudio } from './audio';
import { createGame,startGame,stepGame,pauseGame,resumeGame,DURATION } from './simulation';
import type { GameEvent,FlightInput } from './types';
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const app=el('app'),canvas=el<HTMLCanvasElement>('flight'),sound=el<HTMLButtonElement>('sound'),name=el<HTMLInputElement>('pilot-name');
const audio=new FlightAudio();
let game=createGame(20260928),pilot='',scene:FlightScene,controls:FlightControls,frameId=0,lastTime=0,accumulator=0,displayClock=0,noticeUntil=0,damageUntil=0;
let finished=false,contextLost=false,settings:ControlSettings;
const pauses=new Set<string>();
const fmt=(n:number)=>Math.floor(n).toLocaleString('ja-JP');
const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;
function notice(message:string){el('feedback').textContent=message;noticeUntil=game.elapsed+1.7;}
function setSoundLabel(){for(const button of [sound,el<HTMLButtonElement>('pause-sound')]){button.textContent=audio.failed&&audio.enabled?'音 再試行':audio.enabled?'音 ON':'音 OFF';button.setAttribute('aria-pressed',String(audio.enabled));button.setAttribute('aria-label',audio.enabled?'効果音を切る':'効果音を入れる');}}
function showHome(){
  settings?.close();
  controls?.clear();audio.active=false;audio.sync();pauses.clear();game=createGame(20260928);finished=false;accumulator=0;lastTime=performance.now();app.classList.remove('playing');
  el('home').hidden=false;for(const id of ['hud','pause-screen','result'])el(id).hidden=true;
  el('damage-flash').style.opacity='0';
}
function begin(){
  const candidate=name.value.trim();
  if(!candidate){el('name-error').textContent='名前を入力してください。';name.focus();return;}
  if(contextLost)return;
  pilot=Array.from(candidate).slice(0,16).join('');name.value=pilot;el('name-error').textContent='';
  // All runs share a reproducible initial encounter; cosmetic randomness is separate.
  game=createGame(20260928);startGame(game);pauses.clear();finished=false;accumulator=0;lastTime=performance.now();controls.clear();app.classList.add('playing');
  el('home').hidden=true;el('result').hidden=true;el('pause-screen').hidden=true;el('hud').hidden=false;
  audio.active=true;void audio.unlock().then(setSoundLabel);audio.sync();notice('敵機を照準に合わせて射撃');updateHud();canvas.focus({preventScroll:true});
}
function pause(reason:string){
  if(game.phase!=='playing'&&game.phase!=='paused')return;
  pauses.add(reason);pauseGame(game);controls.clear();accumulator=0;audio.active=false;audio.sync();el('pause-screen').hidden=false;
  el('pause-note').textContent=reason==='slow'?'画面の更新が止まったため一時停止しました。準備ができたら再開できます。':reason==='context'?'描画を復旧しています。':'準備ができたら、飛行を再開できます。';
}
function resume(){
  if(document.hidden||contextLost||settings.isOpen)return;
  pauses.clear();resumeGame(game);controls.clear();lastTime=performance.now();accumulator=0;el('pause-screen').hidden=true;audio.active=true;void audio.unlock().then(setSoundLabel);audio.sync();canvas.focus({preventScroll:true});
}
function finish(){
  if(finished)return;finished=true;controls.clear();audio.active=false;audio.sync();el('hud').hidden=true;el('pause-screen').hidden=true;el('result').hidden=false;
  el('result-pilot').textContent=`${pilot}さんの記録`;el('result-score').textContent=fmt(game.score);
  el('result-reason').textContent=game.endReason==='time'?'5分間の飛行を終えました':game.endReason==='ammo'?'すべての弾を使い切りました':'機体が撃墜されました';
  el('result-kills').textContent=`${game.kills}機`;el('result-shots').textContent=`${fmt(game.shots)}発`;el('result-loops').textContent=`${game.loops}回`;el('result-time').textContent=`${game.elapsed.toFixed(1)}秒`;
  el('result-damage').textContent=`−${fmt(game.damageTaken*10)}点（損傷 ${fmt(game.damageTaken)}%）`;
  el('retry').focus({preventScroll:true});
}
function updateHud(){
  const p=game.player;
  el('timer').textContent=clock(Math.ceil(Math.max(0,DURATION-game.elapsed)));
  el('health').textContent=`${Math.max(0,Math.ceil(p.health))}%`;el('health-fill').style.width=`${Math.max(0,p.health)}%`;el('health-fill').style.background=p.health<35?'#efab84':'#bdd9c7';
  el('kills').textContent=fmt(game.kills);el('loops').textContent=fmt(game.loops);el('score').textContent=fmt(game.score);
  el('mg').textContent=fmt(p.mg);el('cannon').textContent=fmt(p.cannon);el('ammo-total').textContent=fmt(p.mg+p.cannon);
  el('speed').textContent=fmt(p.speed*3.6);el('altitude').textContent=fmt(p.position.y);
  el('loop-status').textContent=p.loopProgress>0?'宙返り中':p.loopCooldown>0?`次の宙返りまで ${p.loopCooldown.toFixed(1)}秒`:p.speed<85?'宙返りには速度が必要':'宙返り可能';
  el('loop').setAttribute('aria-disabled',String(p.loopProgress>0||p.loopCooldown>0||p.speed<85));
  if(game.elapsed>noticeUntil)el('feedback').textContent='';
  el('damage-flash').style.opacity=game.elapsed<damageUntil?'.5':'0';
}
function onEvents(events:GameEvent[]){for(const e of events){audio.event(e,e.owner===game.player.id);if(e.type==='kill'&&e.owner===game.player.id)notice('撃墜');if(e.type==='loop')notice('宙返り +150');if(e.type==='damage'&&e.owner===game.player.id){notice('被弾 — 損傷に応じて減点');damageUntil=game.elapsed+.3;}}}
function frame(time:number){
  frameId=requestAnimationFrame(frame);
  const raw=(time-(lastTime||time))/1000;lastTime=time;
  if(raw>1&&game.phase==='playing')pause('slow');
  const dt=Math.min(raw,.25);
  if(game.phase==='playing'){
    accumulator+=raw;const gathered:GameEvent[]=[];let input:FlightInput|undefined;
    while(accumulator>=1/60&&game.phase==='playing'){
      const tickInput:FlightInput=input?{...input,loop:false}:controls.sample();input=tickInput;stepGame(game,tickInput,1/60);gathered.push(...game.events);accumulator-=1/60;
    }
    game.events=gathered;onEvents(gathered);audio.update(game.player.speed);
    if(game.endReason!==null)finish();
  }else if(game.phase==='ended'&&!document.hidden){
    accumulator+=dt;
    while(accumulator>=1/60){stepGame(game,{turn:0,climb:0,fire:false,loop:false},1/60);accumulator-=1/60;}
  }
  if(!contextLost){scene.render(game,game.phase==='paused'||document.hidden?0:dt);const aim=scene.aimScreen();el('reticle').style.left=`${aim.x}px`;el('reticle').style.top=`${aim.y}px`;}
  displayClock+=dt;if(displayClock>=.08){displayClock=0;updateHud();radar.draw(game);}
}
const radar=new SphereRadar(el<HTMLCanvasElement>('radar'));
function resize(){const rect=app.getBoundingClientRect();if(rect.width>0&&rect.height>0)scene.resize(rect.width,rect.height);}
function fatal(error:unknown){cancelAnimationFrame(frameId);el('loading').hidden=true;el('error-screen').hidden=false;el('error-text').textContent='3Dの画面を開けませんでした。Safariなどの新しいブラウザで、読み込み直してください。';console.error('Flight initialization failed',error);}
try{
  scene=new FlightScene(canvas);resize();
  const buttons={fire:el<HTMLButtonElement>('fire'),loop:el<HTMLButtonElement>('loop'),accelerate:el<HTMLButtonElement>('accelerate'),brake:el<HTMLButtonElement>('brake')};
  settings=new ControlSettings(buttons);
  controls=new FlightControls(canvas,buttons,()=>game.phase==='playing'&&!settings.isOpen);
  el('loading').hidden=true;showHome();frameId=requestAnimationFrame(frame);
  new ResizeObserver(resize).observe(app);
  window.visualViewport?.addEventListener('resize',resize);
  el('start-form').addEventListener('submit',e=>{e.preventDefault();begin();});
  el('pause').addEventListener('click',()=>pause('manual'));el('resume').addEventListener('click',resume);
  el('quit').addEventListener('click',showHome);el('home-button').addEventListener('click',showHome);el('retry').addEventListener('click',begin);
  const about=el<HTMLDialogElement>('about');el('about-open').addEventListener('click',()=>about.showModal());el('about-close').addEventListener('click',()=>about.close());
  for(const id of ['home-controls','pause-controls'])el(id).addEventListener('click',()=>{controls.clear();settings.open(el(id));});
  for(const button of [sound,el<HTMLButtonElement>('pause-sound')])button.addEventListener('click',()=>{if(audio.failed&&audio.enabled){void audio.unlock().then(setSoundLabel);return;}audio.enabled=!audio.enabled;if(audio.enabled)void audio.unlock().then(setSoundLabel);audio.sync();setSoundLabel();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('hidden');});
  window.addEventListener('blur',()=>{controls.clear();pause('focus');});
  window.addEventListener('pagehide',()=>pause('pagehide'));
  window.addEventListener('pageshow',()=>{lastTime=performance.now();if(game.phase==='paused')resize();});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;pause('context');if(game.phase==='ready'||game.phase==='ended')el('error-screen').hidden=false;el<HTMLButtonElement>('resume').disabled=true;});
  canvas.addEventListener('webglcontextrestored',()=>{contextLost=false;el('error-screen').hidden=true;el<HTMLButtonElement>('resume').disabled=false;el('pause-note').textContent='画面が復旧しました。飛行を再開できます。';resize();});
  if(import.meta.env.DEV){
    Object.defineProperty(window,'flightSnapshot',{configurable:true,value:()=>({phase:game.phase,elapsed:game.elapsed,kills:game.kills,shots:game.shots,loops:game.loops,score:game.score,damageTaken:game.damageTaken,player:{position:game.player.position.toArray(),quaternion:game.player.quaternion.toArray(),speed:game.player.speed,health:game.player.health,mg:game.player.mg,cannon:game.player.cannon,loopProgress:game.player.loopProgress},enemies:game.enemies.map(e=>({id:e.id,position:e.position.toArray(),mode:e.mode,health:e.health,speed:e.speed,mg:e.mg,cannon:e.cannon})),wrecks:game.wrecks.map(w=>({id:w.id,position:w.position.toArray(),age:w.age})),bullets:game.bullets.length,endReason:game.endReason,render:scene.stats()})});
  }
}catch(error){fatal(error);}
el('reload').addEventListener('click',()=>location.reload());
