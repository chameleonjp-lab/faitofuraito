import type { FlightInput } from './types';
export class FlightControls {
  private steer:number|null=null;
  private fires=new Set<number>();
  private origin={x:0,y:0,time:0};
  private last={x:0,y:0};
  private keys=new Set<string>();
  private loop=false;
  private turn=0;
  private climb=0;
  private abort=new AbortController();
  constructor(private surface:HTMLElement, private fire:HTMLButtonElement, private active:()=>boolean){
    const opts={signal:this.abort.signal};
    surface.addEventListener('pointerdown',e=>{
      if(!this.active() || this.steer!==null || (e.pointerType==='mouse' && e.button!==0))return;
      e.preventDefault(); this.steer=e.pointerId;this.origin={x:e.clientX,y:e.clientY,time:e.timeStamp};this.last={x:e.clientX,y:e.clientY};surface.setPointerCapture(e.pointerId);
    },opts);
    surface.addEventListener('pointermove',e=>{
      if(e.pointerId!==this.steer)return;
      e.preventDefault();this.last={x:e.clientX,y:e.clientY};
      this.turn=Math.max(-1,Math.min(1,(e.clientX-this.origin.x)/95));
      this.climb=Math.max(-1,Math.min(1,(this.origin.y-e.clientY)/130));
    },opts);
    const release=(e:PointerEvent)=>{
      if(e.pointerId!==this.steer)return;
      const dy=this.origin.y-e.clientY,dx=Math.abs(e.clientX-this.origin.x),ms=e.timeStamp-this.origin.time;
      if(e.type==='pointerup' && this.active() && dy>=80 && ms>0 && ms<=380 && dy/ms>=0.6 && dx<dy*.65)this.loop=true;
      this.steer=null;this.turn=0;this.climb=0;
    };
    for(const name of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(name,release as EventListener,opts);
    fire.addEventListener('pointerdown',e=>{
      if(!this.active() || (e.pointerType==='mouse' && e.button!==0))return;
      e.preventDefault(); this.fires.add(e.pointerId);fire.setPointerCapture(e.pointerId);fire.classList.add('firing');
    },opts);
    const endFire=(e:PointerEvent)=>{this.fires.delete(e.pointerId);if(!this.fires.size)fire.classList.remove('firing');};
    for(const name of ['pointerup','pointercancel','lostpointercapture'])fire.addEventListener(name,endFire as EventListener,opts);
    // Keyboard/assistive activation of the native button emits one short burst.
    fire.addEventListener('click',e=>{if(e.detail===0 && this.active()){this.keys.add('burst');}},opts);
    window.addEventListener('keydown',e=>{
      if(!this.active() || e.isComposing || /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName))return;
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','KeyL'].includes(e.code)){
        e.preventDefault();this.keys.add(e.code);if(e.code==='KeyL'&&!e.repeat)this.loop=true;
      }
    },opts);
    window.addEventListener('keyup',e=>this.keys.delete(e.code),opts);
    window.addEventListener('blur',()=>this.clear(),opts);
    surface.addEventListener('contextmenu',e=>e.preventDefault(),opts);
    fire.addEventListener('contextmenu',e=>e.preventDefault(),opts);
  }
  sample():FlightInput{
    const input={turn:this.turn+(this.keys.has('ArrowRight')?1:0)-(this.keys.has('ArrowLeft')?1:0),climb:this.climb+(this.keys.has('ArrowUp')?1:0)-(this.keys.has('ArrowDown')?1:0),fire:this.fires.size>0||this.keys.has('Space')||this.keys.has('burst'),loop:this.loop};
    input.turn=Math.max(-1,Math.min(1,input.turn));input.climb=Math.max(-1,Math.min(1,input.climb));this.loop=false;this.keys.delete('burst');return input;
  }
  clear(){this.steer=null;this.fires.clear();this.keys.clear();this.loop=false;this.turn=0;this.climb=0;this.fire.classList.remove('firing');}
  dispose(){this.clear();this.abort.abort();}
}
