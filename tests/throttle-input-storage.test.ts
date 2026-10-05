import { createGame, startGame, stepGame } from '../src/simulation';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightControls } from '../src/input';
import { DEFAULT_LAYOUT, decodeControlLayout, controlDimensions, rectangularBounds, safeThrottlePlacement } from '../src/control-settings';
import { persistSettingsBatch, readSettingsValue, SETTINGS_RECOVERY_KEY } from '../src/settings-storage';
const close=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-10);
class NodeStub extends EventTarget {
  attrs = new Map<string,string>(); captured = new Set<number>(); failCapture=false;
  style={left:'',top:'',setProperty(){},removeProperty(){}}; classList={add(){},remove(){},toggle(){}};
  getAttribute(k:string){return this.attrs.get(k)??null;} setAttribute(k:string,v:string){this.attrs.set(k,v);}
  getBoundingClientRect(){return {left:0,top:100,bottom:244,width:72,height:144};}
  closest(selector:string){return selector==='#app'?this:null;} querySelector(){return this;}
  setPointerCapture(id:number){if(this.failCapture)throw Error('capture denied');this.captured.add(id);} hasPointerCapture(id:number){return this.captured.has(id);} releasePointerCapture(id:number){this.captured.delete(id);}
}
function pointer(type:string,id:number,y=122,extra={}) {return Object.assign(new Event(type,{cancelable:true}),{pointerId:id,clientX:36,clientY:y,pointerType:'touch',button:0,buttons:1,isPrimary:false,...extra});}
function key(type:string,code:string,extra={}) {return Object.assign(new Event(type,{cancelable:true}),{code,repeat:false,isComposing:false,ctrlKey:false,metaKey:false,altKey:false,...extra});}
function controlsFixture() {
  const originals=['window','document','HTMLElement'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const);
  const win=Object.assign(new EventTarget(),{visualViewport:new EventTarget()}); const doc=Object.assign(new EventTarget(),{hidden:false,getElementById:()=>new NodeStub()});
  for(const [k,v] of [['window',win],['document',doc],['HTMLElement',NodeStub]] as const)Object.defineProperty(globalThis,k,{configurable:true,value:v});
  const surface=new NodeStub(), throttle=new NodeStub(), fire=new NodeStub(), loop=new NodeStub();let active=true;
  const controls=new FlightControls(surface as any,{throttle,fire,loop} as any,()=>active);
  return {win,doc,surface,throttle,fire,controls,setActive(value:boolean){active=value;},cleanup(){controls.dispose();for(const [k,v]of originals)if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}};
}
test('real adapter owns one lever pointer independently from steering/fire and clears only its owner', () => {
  const f=controlsFixture();try{
    f.surface.dispatchEvent(pointer('pointerdown',1,170,{isPrimary:true}));f.win.dispatchEvent(pointer('pointermove',1,155,{clientX:60}));
    f.fire.dispatchEvent(pointer('pointerdown',2));f.throttle.dispatchEvent(pointer('pointerdown',3));
    assert.equal(f.controls.sample().throttle,1);assert.equal(f.controls.sample().fire,true);assert.notEqual(f.controls.sample().turn,0);
    f.throttle.dispatchEvent(pointer('pointerdown',4,222));assert.equal(f.controls.peek().throttlePointer,3);
    for(const type of ['pointerup','pointercancel','lostpointercapture']) f.throttle.dispatchEvent(pointer(type,4));
    assert.equal(f.controls.peek().throttlePointer,3);
    f.win.dispatchEvent(pointer('pointermove',3,400));assert.equal(f.controls.sample().throttle,-1);
    f.win.dispatchEvent(pointer('pointerup',3));assert.equal(f.controls.sample().throttle,0);assert.equal(f.controls.sample().fire,true);assert.equal(f.controls.peek().steerPointer,1);
    f.throttle.dispatchEvent(pointer('pointerdown',1));assert.equal(f.controls.peek().throttlePointer,null,'cannot steal steering pointer');
    f.controls.clear();for(const pointerType of ['mouse','pen']) {f.throttle.dispatchEvent(pointer('pointerdown',8,122,{pointerType,button:2}));assert.equal(f.controls.peek().throttlePointer,null);}
    f.throttle.failCapture=true;f.throttle.dispatchEvent(pointer('pointerdown',9));assert.equal(f.controls.sample().throttle,0);
  }finally{f.cleanup();}
});
test('focused short commands survive zero-tick frames, consume once, cancel safely, and coexist with pointer',()=>{
  const f=controlsFixture();try{
    f.throttle.dispatchEvent(key('keydown','ArrowUp'));f.throttle.dispatchEvent(key('keyup','ArrowUp'));
    assert.equal(f.controls.sample(false).throttle,1);assert.equal(f.controls.sample(false).throttle,1);
    assert.equal(f.controls.sampleThrottle(),1);assert.equal(f.controls.sampleThrottle(),0,'catchup ticks cannot replay pulse');
    for(const terminal of ['pointerup','pointercancel','lostpointercapture']){
      f.throttle.dispatchEvent(key('keydown','ArrowDown'));f.throttle.dispatchEvent(pointer('pointerdown',4));f.controls.sampleThrottle();
      (terminal === 'lostpointercapture' ? f.throttle : f.win).dispatchEvent(pointer(terminal,4));assert.equal(f.controls.sampleThrottle(),-1);f.throttle.dispatchEvent(key('keyup','ArrowDown'));assert.equal(f.controls.sampleThrottle(),0);
    }
    f.throttle.dispatchEvent(key('keydown','ArrowUp'));f.throttle.dispatchEvent(key('keydown','ArrowDown'));f.throttle.dispatchEvent(key('keyup','ArrowUp'));f.throttle.dispatchEvent(key('keyup','ArrowDown'));assert.equal(f.controls.sampleThrottle(),0);
    f.throttle.dispatchEvent(key('keydown','ArrowUp'));f.throttle.dispatchEvent(key('keyup','ArrowUp'));f.win.dispatchEvent(new Event('blur'));assert.equal(f.controls.sampleThrottle(),0);
    f.throttle.dispatchEvent(key('keydown','ArrowUp',{repeat:true}));assert.equal(f.controls.sampleThrottle(),0);
    f.throttle.dispatchEvent(key('keydown','ArrowUp',{isComposing:true}));assert.equal(f.controls.sampleThrottle(),0);
    f.win.dispatchEvent(key('keydown','ArrowUp'));assert.equal(f.controls.sample().climb,1);f.throttle.dispatchEvent(new Event('focusin'));assert.equal(f.controls.sample().climb,0);
    f.win.dispatchEvent(key('keydown','KeyS'));f.throttle.dispatchEvent(pointer('pointerdown',5,145));close(f.controls.sample().throttle!,-.5);
    for(const event of ['resize','blur','pagehide']){f.win.dispatchEvent(new Event(event));assert.equal(f.controls.sample().throttle,0);f.throttle.dispatchEvent(pointer('pointerdown',6));}
    f.controls.setMode('easy');assert.equal(f.controls.sample().throttle,0);f.throttle.dispatchEvent(pointer('pointerdown',7));assert.equal(f.controls.peek().throttlePointer,null);
  }finally{f.cleanup();}
});
function storage(){const map=new Map<string,string>();return {map,getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}};}
test('v1 custom migration is pure, preserves peers and uses rectangular safe placement in both orientations',()=>{
  for(const [w,h]of [[320,568],[568,320],[393,852],[852,393]])for(const mirror of [false,true]){
    const old={version:1,controls:{...structuredClone(DEFAULT_LAYOUT),accelerate:{x:mirror?.83:.17,y:.84,size:76,opacity:.8},brake:{x:mirror?.83:.17,y:.66,size:76,opacity:.8}}};
    delete (old.controls as any).throttle;const raw=JSON.stringify(old),layout=decodeControlLayout(raw,true);const saved=JSON.stringify(layout);
    const insets={top:0,bottom:21,left:w>h?44:0,right:w>h?44:0};const lever=safeThrottlePlacement(layout,w,h,insets);assert.equal(lever.blocked,false);const d=controlDimensions('throttle',lever.size,w,h,insets);
    const b=rectangularBounds(d,w,h,insets);assert.ok(lever.x>=b.minX&&lever.x<=b.maxX);assert.ok(lever.y>=b.minY&&lever.y<=b.maxY);assert.ok(d.width>=44&&d.height>=44);
    assert.equal(JSON.stringify(layout),saved);assert.equal(JSON.stringify(old),raw);assert.deepEqual(layout.fire,old.controls.fire);
  }
  assert.deepEqual(decodeControlLayout('{broken',true),DEFAULT_LAYOUT);assert.deepEqual(decodeControlLayout('{"version":99,"controls":{}}'),DEFAULT_LAYOUT);
});
test('rollback failure retains a bounded raw recovery snapshot, read-only reload and future-write protection',()=>{
  const s=storage(),key='faitofuraito-controls-v2',keys='faitofuraito-keyboard-v1';s.map.set(key,'old');s.map.set(keys,'old keys');let rollbackFail=true;
  const write=s.setItem;s.setItem=(k,v)=>{if((k===keys&&v==='new keys')||(rollbackFail&&k===key&&v==='old'))throw Error('storage failure');write(k,v);};
  assert.equal(persistSettingsBatch([{key,value:'new',maxVersion:2},{key:keys,value:'new keys'}],s),false);
  assert.ok(s.getItem(SETTINGS_RECOVERY_KEY));assert.equal(s.getItem(key),'new');assert.equal(readSettingsValue(key,s),'old');
  const future='{"version":3,"controls":{"future":true}}';s.map.set(key,future);rollbackFail=false;
  assert.equal(persistSettingsBatch([{key,value:'replacement',maxVersion:2}],s),false);assert.equal(s.getItem(key),future);
  s.map.set(key,'new');assert.equal(persistSettingsBatch([{key,value:'recovered',maxVersion:2}],s),true);assert.equal(s.getItem(key),'recovered');assert.equal(s.getItem(SETTINGS_RECOVERY_KEY),null);
});
test('v2 Save leaves v1 bytes unchanged and refuses future legacy or current versions',()=>{
  const s=storage(),key='faitofuraito-controls-v2',legacyKey='faitofuraito-controls-v1';const raw=JSON.stringify({version:1,controls:DEFAULT_LAYOUT});s.map.set(legacyKey,raw);
  assert.equal(persistSettingsBatch([{key,legacyKey,maxVersion:2,value:JSON.stringify({version:2,controls:DEFAULT_LAYOUT})}],s),true);assert.equal(s.getItem(legacyKey),raw);
  s.map.delete(key);s.map.set(legacyKey,'{"version":5}');assert.equal(persistSettingsBatch([{key,legacyKey,maxVersion:2,value:'{}'}],s),false);assert.equal(s.getItem(key),null);
  s.map.set(key,'{"version":3}');assert.equal(persistSettingsBatch([{key,legacyKey,maxVersion:2,value:'{}'}],s),false);assert.equal(s.getItem(key),'{"version":3}');
});

test('actual fixed-step recorded input replays one short pulse once across catchup ticks',()=>{
  const f=controlsFixture();try {
    const game=createGame(123,'normal'), replay=createGame(123,'normal');startGame(game);startGame(replay);
    f.throttle.dispatchEvent(key('keydown','ArrowUp')); f.throttle.dispatchEvent(key('keyup','ArrowUp'));
    const frameInput=f.controls.sample(false); const recorded=[];
    for(let tick=0;tick<3;tick++){const consumed={...frameInput,throttle:f.controls.sampleThrottle()};recorded.push(consumed);stepGame(game,consumed,1/60);}
    assert.deepEqual(recorded.map(input=>input.throttle),[1,0,0]);
    for(const input of recorded)stepGame(replay,input,1/60);
    assert.deepEqual(replay.player,game.player);assert.ok(game.player.speed>110);
  }finally{f.cleanup();}
});
test('malformed or future recovery journals cannot restore or read foreign keys',()=>{
  for(const raw of ['{bad',JSON.stringify({version:2,previous:[]}),JSON.stringify({version:1,previous:[{key:'other-game',value:'old',next:'new'}]}),JSON.stringify({version:1,previous:[{key:'faitofuraito-controls-v2',value:null,next:'x'},{key:'faitofuraito-controls-v2',value:null,next:'x'}]}),'x'.repeat(65537)]){
    const s=storage();s.map.set(SETTINGS_RECOVERY_KEY,raw);s.map.set('other-game','untouched');
    assert.equal(persistSettingsBatch([{key:'faitofuraito-controls-v2',value:'x',maxVersion:2}],s),false);assert.equal(s.getItem('other-game'),'untouched');assert.equal(s.getItem(SETTINGS_RECOVERY_KEY),raw);
  }
  const s=storage(),future='{"version":3,"controls":{}}';s.map.set('faitofuraito-controls-v2',future);s.map.set(SETTINGS_RECOVERY_KEY,JSON.stringify({version:1,previous:[{key:'faitofuraito-controls-v2',value:'{"version":2}',next:future}]}));
  assert.equal(persistSettingsBatch([{key:'faitofuraito-controls-v2',value:'x',maxVersion:2}],s),false);assert.equal(s.getItem('faitofuraito-controls-v2'),future);
});

test('three independent sources add before the single final clamp',()=>{
 const f=controlsFixture();try{
  f.throttle.dispatchEvent(pointer('pointerdown',1));f.throttle.dispatchEvent(key('keydown','ArrowUp'));f.win.dispatchEvent(key('keydown','KeyS'));
  assert.equal(f.controls.sample().throttle,1);assert.equal(f.controls.sampleThrottle(),1);
 }finally{f.cleanup();}
});

test('utility rectangles displace only the lever and focused keyboard transfer preserves live pointers',()=>{
 for(const [width,height]of [[320,568],[568,320]]){
  const layout=structuredClone(DEFAULT_LAYOUT);layout.throttle.x=.85;layout.throttle.y=.12;
  const obstacle={x:width*.85,y:height*.12,width:110,height:88};const copy=JSON.stringify(layout);
  const lever=safeThrottlePlacement(layout,width,height,{top:0,right:0,bottom:0,left:0},[obstacle]);
  const d=controlDimensions('throttle',lever.size,width,height);assert.equal(lever.blocked,false);
  assert.ok(Math.abs(lever.x*width-obstacle.x)>=(d.width+obstacle.width)/2+2||Math.abs(lever.y*height-obstacle.y)>=(d.height+obstacle.height)/2+2);
  assert.equal(JSON.stringify(layout),copy);
 }
 const f=controlsFixture();try{
  f.surface.dispatchEvent(pointer('pointerdown',1,170,{isPrimary:true}));f.win.dispatchEvent(pointer('pointermove',1,155,{clientX:60}));f.fire.dispatchEvent(pointer('pointerdown',2));
  f.win.dispatchEvent(key('keydown','ArrowUp'));f.throttle.dispatchEvent(new Event('focusin'));
  assert.notEqual(f.controls.sample().turn,0);assert.equal(f.controls.sample().fire,true);assert.equal(f.controls.peek().steerPointer,1);assert.equal(f.controls.peek().keys.length,0);
 }finally{f.cleanup();}
});
