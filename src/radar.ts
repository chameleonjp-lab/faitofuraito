import { Vector3 } from 'three';
import type { GameState } from './types';
const relative=new Vector3();
export class SphereRadar {
  private ctx:CanvasRenderingContext2D;
  constructor(private canvas:HTMLCanvasElement){this.ctx=canvas.getContext('2d')!;}
  draw(state:GameState){
    const c=this.ctx,dpr=Math.min(window.devicePixelRatio||1,2),size=this.canvas.clientWidth;
    if(this.canvas.width!==Math.round(size*dpr)){this.canvas.width=Math.round(size*dpr);this.canvas.height=Math.round(size*dpr);}
    c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,size,size);
    const r=size*.40,cx=size/2,cy=size*.50;
    const bg=c.createRadialGradient(cx-r*.3,cy-r*.4,0,cx,cy,r);bg.addColorStop(0,'rgba(48,84,94,.58)');bg.addColorStop(1,'rgba(5,20,29,.78)');
    c.fillStyle=bg;c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.fill();
    c.lineWidth=1;c.strokeStyle='rgba(172,216,222,.35)';c.stroke();
    c.beginPath();c.ellipse(cx,cy,r,r*.35,0,0,Math.PI*2);c.stroke();
    c.strokeStyle='rgba(172,216,222,.17)';c.beginPath();c.ellipse(cx,cy,r*.36,r,0,0,Math.PI*2);c.stroke();
    c.beginPath();c.moveTo(cx-r,cy);c.lineTo(cx+r,cy);c.moveTo(cx,cy-r);c.lineTo(cx,cy+r);c.stroke();
    // Body-relative forward/right/height, viewed from above and behind the sphere.
    const inv=state.player.quaternion.clone().invert();
    const contacts=state.enemies.map(e=>{
      relative.copy(e.position).sub(state.player.position).applyQuaternion(inv);
      const distance=relative.length();const scale=1/1400;
      return {x:relative.x*scale,y:relative.y*scale,z:relative.z*scale,distance,empty:e.mg+e.cannon===0};
    }).filter(e=>e.distance<=1400).sort((a,b)=>a.z-b.z);
    for(const e of contacts){
      const x=cx+e.x*r*.9,baseY=cy+e.z*r*.34,y=baseY-e.y*r*.84;
      c.strokeStyle=e.empty?'#b1c5c5':'#f3b679';c.globalAlpha=e.z<0?1:.7;
      c.beginPath();c.moveTo(x,baseY);c.lineTo(x,y);c.stroke();
      c.beginPath();c.ellipse(x,baseY,2.5,1,0,0,Math.PI*2);c.stroke();
      c.fillStyle=e.empty?'#b1c5c5':'#ffd09e';c.beginPath();c.moveTo(x,y-3.4);c.lineTo(x+3.4,y);c.lineTo(x,y+3.4);c.lineTo(x-3.4,y);c.closePath();e.empty?c.stroke():c.fill();
    }
    c.globalAlpha=1;c.fillStyle='#e2fffc';c.beginPath();c.moveTo(cx,cy-5);c.lineTo(cx+3.6,cy+4);c.lineTo(cx,cy+2);c.lineTo(cx-3.6,cy+4);c.closePath();c.fill();
    c.font='10px sans-serif';c.textAlign='center';c.fillStyle='#c9dedc';c.fillText('前',cx,cy-r-4);c.fillText('後',cx,cy+r+12);
    this.canvas.setAttribute('aria-label',`立体レーダー。自機を中心に敵${state.enemies.length}機。線の高さは自機との高低差。`);
  }
}
