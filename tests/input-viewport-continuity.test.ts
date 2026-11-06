import test from 'node:test';
import assert from 'node:assert/strict';
import {FlightControls} from '../src/input';
class ElementStub extends EventTarget {
 style={left:'',top:'',setProperty(){},removeProperty(){}};classList={add(){},remove(){}};
 getAttribute(){return null;}setAttribute(){}getBoundingClientRect(){return {left:0,top:0};}closest(){return this;}querySelector(){return this;}setPointerCapture(){}hasPointerCapture(){return false;}
}
const pointer=(type:string,id:number,x=100,y=200)=>Object.assign(new Event(type,{cancelable:true}),{pointerId:id,clientX:x,clientY:y,pointerType:'touch',button:0,buttons:1,isPrimary:false});
test('height-only viewport changes retain steering and fire ownership and rebase the next coordinate',()=>{
 const keys=['window','document','HTMLElement'];const originals=keys.map(k=>Object.getOwnPropertyDescriptor(globalThis,k));
 const win=Object.assign(new EventTarget(),{innerWidth:402,innerHeight:874,visualViewport:new EventTarget()}),doc=Object.assign(new EventTarget(),{hidden:false,getElementById:()=>new ElementStub()});
 Object.defineProperties(globalThis,{window:{configurable:true,value:win},document:{configurable:true,value:doc},HTMLElement:{configurable:true,value:ElementStub}});
 const surface=new ElementStub(),fire=new ElementStub(),controls=new FlightControls(surface as any,{fire} as any,()=>true);
 try{
  surface.dispatchEvent(pointer('pointerdown',1));win.dispatchEvent(pointer('pointermove',1,130,180));fire.dispatchEvent(pointer('pointerdown',2));const before=controls.sample();
  win.innerHeight=820;win.dispatchEvent(new Event('resize'));win.visualViewport.dispatchEvent(new Event('resize'));
  assert.equal(controls.peek().steerPointer,1);assert.equal(controls.sample().fire,true);
  win.dispatchEvent(pointer('pointermove',1,130,150));assert.equal(controls.sample().turn,before.turn);assert.equal(controls.sample().climb,before.climb);
  win.dispatchEvent(pointer('pointermove',1,132,150));assert.ok(controls.sample().turn>before.turn);
  const held=controls.sample();
  // Browser UI can shrink height across the square boundary without rotating.
  for(const height of [430,390]){
   win.innerHeight=height;win.dispatchEvent(new Event('resize'));win.visualViewport.dispatchEvent(new Event('resize'));
   assert.equal(controls.peek().steerPointer,1);assert.equal(controls.sample().fire,true);
   win.dispatchEvent(pointer('pointermove',1,132,150));
   assert.equal(controls.sample().turn,held.turn);assert.equal(controls.sample().climb,held.climb);
  }
  win.dispatchEvent(pointer('pointercancel',2));assert.equal(controls.peek().steerPointer,1);assert.equal(controls.sample().fire,false);
  win.dispatchEvent(new Event('orientationchange'));assert.equal(controls.peek().steerPointer,null);
  surface.dispatchEvent(pointer('pointerdown',3));win.dispatchEvent(pointer('pointermove',3,120,190));assert.equal(controls.peek().steerPointer,3);
  win.innerWidth=874;win.innerHeight=402;win.dispatchEvent(new Event('resize'));assert.equal(controls.peek().steerPointer,null);
 }finally{controls.dispose();keys.forEach((k,i)=>originals[i]?Object.defineProperty(globalThis,k,originals[i]!):Reflect.deleteProperty(globalThis,k));}
});
