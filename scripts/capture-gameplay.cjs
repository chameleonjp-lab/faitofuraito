/* One local, anonymous, live-engine screenshot. Never runs a completed game or submits a score. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {DEFAULT_GAME_URL,prepareBrowserCheck,startLocalVitePreviewServer}=require('./browser-check-policy.cjs');
const {closeLocalBrowserCheckSession}=require('./browser-check.cjs');

const CAPTURE_PATH=path.resolve(__dirname,'../evidence/faito-share-gameplay-capture.png');
const ALLOWED_MOCKS=new Set(['get_best_score_ranking','start_faitofuraito_guest_play_v1']);

function writeCapture(buffer){
 fs.mkdirSync(path.dirname(CAPTURE_PATH),{recursive:true});
 fs.writeFileSync(CAPTURE_PATH,buffer,{flag:'wx'});
}

async function createLocalCaptureSession({chromiumImplementation}={}){
 return prepareBrowserCheck({
  env:{GAME_URL:DEFAULT_GAME_URL,START_TEST_SERVER:'1'},
  chromium:chromiumImplementation,
  startTestServer:startLocalVitePreviewServer,
 });
}

/** Test-only instrumentation samples the real WebGL drawing buffer once after gameplay starts. */
function installGameplayRenderInstrumentation(){
 const stats={drawCalls:0,frames:0,sampledColors:[],distinctColors:0,sampled:false,armed:false,gl:null,reset(){
  this.drawCalls=0;this.frames=0;this.sampledColors=[];this.distinctColors=0;this.sampled=false;this.armed=true;this.gl=null;
 }};
 Object.defineProperty(window,'__faitoCaptureRenderStats',{configurable:false,value:stats});
 const prototypes=new Set([window.WebGL2RenderingContext?.prototype,window.WebGLRenderingContext?.prototype].filter(Boolean));
 for(const prototype of prototypes){
  for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','drawRangeElements']){
   const original=prototype[method];
   if(typeof original!=='function')continue;
   Object.defineProperty(prototype,method,{configurable:true,writable:true,value:function(...args){
    stats.drawCalls++;stats.gl=this;return Reflect.apply(original,this,args);
   }});
  }
 }
 const requestFrame=window.requestAnimationFrame.bind(window);
 window.requestAnimationFrame=function(callback){
  return requestFrame(time=>{
   callback(time);stats.frames++;
   if(stats.armed&&!stats.sampled&&stats.drawCalls>0&&stats.gl){
    stats.sampled=true;
    try{
     const gl=stats.gl,width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
     const positions=[.1,.3,.5,.7,.9].flatMap(x=>[.2,.5,.8].map(y=>[Math.floor(width*x),Math.floor(height*y)]));
     stats.sampledColors=positions.map(([x,y])=>{
      const pixel=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return `${pixel[0]},${pixel[1]},${pixel[2]}`;
     });
     stats.distinctColors=new Set(stats.sampledColors).size;
    }catch{stats.sampledColors=[];stats.distinctColors=0;}
   }
  });
 };
}

function waitForActiveNormalGameplay(timerBefore){
 const visible=id=>{const element=document.querySelector(id);return !!element&&!element.hidden;};
 const timer=document.querySelector('#timer')?.textContent?.trim()??'';
 const timerLabel=document.querySelector('#timer-label')?.textContent??'';
 const mode=document.querySelector('input[name="game-mode"]:checked')?.value;
 const stats=window.__faitoCaptureRenderStats;
 const canvas=document.querySelector('#flight');
 return mode==='normal'&&timer!==timerBefore&&timerLabel.includes('無制限')
  &&!visible('#home')&&visible('#hud')&&!visible('#result')&&!visible('#loading')
  &&!visible('#error-screen')&&!visible('#pause-screen')
  &&canvas?.width>=320&&canvas?.height>=240&&stats?.drawCalls>0&&stats?.sampled
  &&stats?.distinctColors>1;
}

function readGameplayState(){
 const visible=id=>{const element=document.querySelector(id);return !!element&&!element.hidden;};
 const canvas=document.querySelector('#flight');
 const stats=window.__faitoCaptureRenderStats??{};
 return {
  mode:document.querySelector('input[name="game-mode"]:checked')?.value??null,
  timer:document.querySelector('#timer')?.textContent?.trim()??'',
  timerLabel:document.querySelector('#timer-label')?.textContent??'',
  homeVisible:visible('#home'),hudVisible:visible('#hud'),resultVisible:visible('#result'),
  loadingVisible:visible('#loading'),errorVisible:visible('#error-screen'),pauseVisible:visible('#pause-screen'),
  canvasWidth:canvas?.width??0,canvasHeight:canvas?.height??0,
  drawCalls:stats.drawCalls??0,frames:stats.frames??0,
  sampledColors:stats.sampledColors??[],distinctColors:stats.distinctColors??0,
 };
}

function assertActiveNormalGameplay(state,timerBefore){
 assert.equal(state.mode,'normal','capture must keep normal mode selected');
 assert.notEqual(state.timer,timerBefore,'normal-mode elapsed time must advance');
 assert.match(state.timerLabel,/無制限/,'normal-mode HUD must identify its unlimited elapsed timer');
 assert.equal(state.homeVisible,false,'home must be hidden');
 assert.equal(state.hudVisible,true,'live HUD must be visible');
 assert.equal(state.resultVisible,false,'result screen must remain hidden');
 assert.equal(state.loadingVisible,false,'loading screen must be hidden');
 assert.equal(state.errorVisible,false,'engine error screen must be hidden');
 assert.equal(state.pauseVisible,false,'game must not be paused');
 assert(state.canvasWidth>=320&&state.canvasHeight>=240,'game canvas must have rendered dimensions');
 assert(state.drawCalls>0,'the live WebGL engine must issue draw calls');
 assert(state.sampledColors.length>=5&&state.distinctColors>1,'the active gameplay canvas must contain non-flat rendered pixels');
}

function assertNetworkGuard(network){
 assert.deepEqual(network.unexpected,[],'capture blocked every unmocked request, redirect, popup, and WebSocket');
 assert(network.mockedRpcCalls.includes('start_faitofuraito_guest_play_v1'),'the anonymous start was locally mocked');
 assert(network.mockedRpcCalls.every(operation=>ALLOWED_MOCKS.has(operation)),'only local ranking reads and anonymous start were mocked');
}

async function captureGameplay({sessionFactory=createLocalCaptureSession,chromiumImplementation=chromium,captureWriter=writeCapture}={}){
 let session;
 try{
  session=await sessionFactory({chromiumImplementation});
  const {page,gameUrl,network}=session;
  await page.setViewportSize({width:1200,height:630});
  await page.addInitScript(installGameplayRenderInstrumentation);
  await page.goto(gameUrl.href);
  await page.locator('#home').waitFor({state:'visible'});
  await page.locator('#error-screen').waitFor({state:'hidden'});
  await page.locator('input[name="game-mode"][value="normal"]').check();
  await page.locator('#pilot-name').fill('');
  assert.equal(await page.locator('#pilot-name').inputValue(),'','capture must use anonymous play');
  assert.equal(await page.locator('input[name="game-mode"]:checked').inputValue(),'normal','capture must use normal mode');
  const timerBefore=await page.locator('#timer').innerText();
  await page.locator('#start').click();
  await page.evaluate(()=>window.__faitoCaptureRenderStats.reset());
  await page.waitForFunction(waitForActiveNormalGameplay,timerBefore,{timeout:15000});

  const state=await page.evaluate(readGameplayState);
  assertActiveNormalGameplay(state,timerBefore);
  assertNetworkGuard(network);
  const png=await page.screenshot({type:'png',fullPage:false});
  assert(Buffer.isBuffer(png)&&png.length>0,'browser screenshot must be returned as PNG bytes before acceptance');

  const afterCapture=await page.evaluate(readGameplayState);
  assertActiveNormalGameplay(afterCapture,timerBefore);
  assertNetworkGuard(network);
  captureWriter(png);
  return {path:CAPTURE_PATH,viewport:{width:1200,height:630},mode:state.mode,phase:'playing',timer:state.timer,render:{calls:state.drawCalls,frames:state.frames,distinctColors:state.distinctColors},localMocks:network.mockedRpcCalls};
 }finally{
  await closeLocalBrowserCheckSession(session);
 }
}

if(require.main===module){
 captureGameplay().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
}

module.exports={CAPTURE_PATH,installGameplayRenderInstrumentation,waitForActiveNormalGameplay,readGameplayState,assertActiveNormalGameplay,captureGameplay};
