import type { GameEvent } from './types';
export class FlightAudio {
  private ctx:AudioContext|null=null;
  private master:GainNode|null=null;
  private engine:OscillatorNode[]=[];
  private engineGain:GainNode|null=null;
  private sources=new Set<AudioScheduledSourceNode>();
  private noise:AudioBuffer|null=null;
  enabled=true;
  active=false;
  failed=false;
  async unlock(){
    if(!this.enabled)return;
    try{
      if(!this.ctx){
        this.ctx=new AudioContext();this.master=this.ctx.createGain();this.master.gain.value=0;this.master.connect(this.ctx.destination);
        this.engineGain=this.ctx.createGain();this.engineGain.gain.value=.095;this.engineGain.connect(this.master);
        for(const [i,f] of [49,98,147].entries()){const o=this.ctx.createOscillator();o.type=i===0?'sawtooth':'sine';o.frequency.value=f;const g=this.ctx.createGain();g.gain.value=[.45,.20,.12][i];o.connect(g).connect(this.engineGain);o.start();this.engine.push(o);}
        this.noise=this.ctx.createBuffer(1,this.ctx.sampleRate*.4,this.ctx.sampleRate);const data=this.noise.getChannelData(0);let seed=47;for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;data[i]=(seed>>>0)/2147483648-1;}
      }
      await this.ctx.resume();this.failed=this.ctx.state!=='running';this.sync();
    }catch{this.failed=true;}
  }
  sync(){if(!this.ctx||!this.master)return;this.master.gain.cancelScheduledValues(this.ctx.currentTime);this.master.gain.setTargetAtTime(this.enabled&&this.active?.6:0,this.ctx.currentTime,.04);if(!this.enabled||!this.active){for(const s of this.sources){try{s.stop();}catch{/* Already ended. */}}this.sources.clear();}}
  update(speed:number){if(!this.ctx)return;this.engine.forEach((o,i)=>o.frequency.setTargetAtTime((40+speed*.13)*(i+1),this.ctx!.currentTime,.15));}
  event(e:GameEvent,playerEvent:boolean){
    if(!this.enabled||!this.active||!this.ctx||this.ctx.state!=='running'||!this.master||!this.noise||this.sources.size>=10)return;
    if(e.type==='shot' && !playerEvent)return;
    if(!['shot','hit','kill','damage','loop'].includes(e.type))return;
    const t=this.ctx.currentTime,g=this.ctx.createGain(),f=this.ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=e.type==='shot'?1800:e.type==='kill'?550:1000;
    const s=this.ctx.createBufferSource();s.buffer=this.noise;s.playbackRate.value=e.type==='kill'?.65:1.3;const length=e.type==='kill'?.38:e.type==='shot'?.05:.12;
    g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(e.type==='shot'?.07:.16,t+.004);g.gain.exponentialRampToValueAtTime(.0001,t+length);
    s.connect(f).connect(g).connect(this.master);this.sources.add(s);s.onended=()=>{this.sources.delete(s);s.disconnect();f.disconnect();g.disconnect();};s.start(t);s.stop(t+length+.02);
  }
  dispose(){for(const s of this.sources){try{s.stop();}catch{}}this.sources.clear();for(const s of this.engine)s.stop();void this.ctx?.close();this.ctx=null;}
}
