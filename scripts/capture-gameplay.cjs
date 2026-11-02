/* One local, anonymous, live-engine screenshot. Never runs a completed game or submits a score. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {DEFAULT_GAME_URL,prepareBrowserCheck,startLocalVitePreviewServer}=require('./browser-check-policy.cjs');
const {closeLocalBrowserCheckSession}=require('./browser-check.cjs');

const CAPTURE_PATH=path.resolve(__dirname,'../evidence/faito-share-gameplay-capture.png');
const FAILURE_ARTIFACT_DIR=path.resolve(__dirname,'../test-results');
const FAILURE_DIAGNOSTICS_PATH=path.join(FAILURE_ARTIFACT_DIR,'faito-capture-failure-diagnostics.json');
const FAILURE_SCREENSHOT_PATH=path.join(FAILURE_ARTIFACT_DIR,'faito-capture-failure.png');
const ALLOWED_MOCKS=new Set(['get_best_score_ranking','start_faitofuraito_guest_play_v1']);
const SAFE_ERROR_NAMES=new Set(['Error','TypeError','ReferenceError','RangeError','SyntaxError','URIError','EvalError','AggregateError','TimeoutError','AssertionError']);

function writeCapture(buffer){
 fs.mkdirSync(path.dirname(CAPTURE_PATH),{recursive:true});
 fs.writeFileSync(CAPTURE_PATH,buffer,{flag:'wx'});
}

const SAFE_STAGES=new Set([
 'opening-capture-session','setting-capture-viewport','installing-render-instrumentation',
 'navigating-to-local-preview','waiting-for-home-and-engine','selecting-anonymous-normal-mode',
 'starting-anonymous-normal-gameplay','waiting-for-active-normal-gameplay','recovering-normal-gameplay-pause','validating-live-gameplay',
 'capturing-anonymous-gameplay-frame','revalidating-live-gameplay-after-screenshot','writing-approved-capture',
]);
const SAFE_PAUSE_REASONS=new Set(['none','slow','context','standard-pause','unknown']);
const SAFE_ACTIVE_ELEMENTS=new Set(['canvas','button','input','select','body','other']);
const SAFE_LIFECYCLE_EVENTS=new Set(['window-blur','window-focus','document-hidden','document-visible','window-pagehide','window-pageshow']);
const SAFE_METHODS=new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS','WEBSOCKET','POPUP']);
const SAFE_NETWORK_REASONS=new Set(['invalid-url','blocked-request','redirect','local-fetch-error','blocked-websocket','blocked-popup']);
const SAFE_ROUTE_CATEGORIES=new Map([
 ['/', 'root'],['/favicon.ico','favicon'],['/manifest.webmanifest','manifest'],
 ['/@vite/client','vite-client'],['/@vite/env','vite-env'],
 ['/rest/v1/rpc/get_best_score_ranking','ranking-read-rpc'],
 ['/rest/v1/rpc/start_faitofuraito_guest_play_v1','anonymous-start-rpc'],
 ['/rest/v1/rpc/submit_score_idempotent_v1','score-submit-rpc'],
]);

function classifyDiagnosticPath(pathname){
 if(typeof pathname!=='string')return 'unknown';
 if(SAFE_ROUTE_CATEGORIES.has(pathname))return SAFE_ROUTE_CATEGORIES.get(pathname);
 if(pathname.startsWith('/@id/'))return 'vite-id';
 if(pathname.startsWith('/@fs/'))return 'vite-fs';
 if(pathname.startsWith('/src/'))return 'vite-source';
 if(pathname.startsWith('/assets/'))return 'built-asset';
 if(pathname.startsWith('/rest/v1/rpc/'))return 'other-rpc';
 return 'unknown';
}

function classifyOrigin(raw){
 try{
  const url=new URL(raw);
  const hostname=url.hostname.toLowerCase();
  const originClass=hostname==='127.0.0.1'||hostname==='localhost'||hostname==='[::1]'?'loopback'
   :hostname.endsWith('.supabase.co')?'supabase':'external';
  const protocolKind=new Set(['http:','https:','ws:','wss:']).has(url.protocol)?url.protocol.slice(0,-1):'other';
  const port=Number(url.port)||0;
  return {originClass,protocolKind,port};
 }catch{return {originClass:'invalid',protocolKind:'other',port:0};}
}

function safeLocation(raw){
 try{
  const url=new URL(raw);
  return {...classifyOrigin(url.origin),routeClass:classifyDiagnosticPath(url.pathname)};
 }catch{return {originClass:'unavailable',protocolKind:'other',port:0,routeClass:'unknown'};}
}

function safeUnexpectedEvents(events){
 return (Array.isArray(events)?events:[]).slice(0,50).map(event=>({
  methodKind:SAFE_METHODS.has(String(event?.method??'').toUpperCase())?String(event.method).toUpperCase():'other',
  ...classifyOrigin(event?.origin),
  routeClass:classifyDiagnosticPath(event?.pathname),
  reason:SAFE_NETWORK_REASONS.has(event?.reason)?event.reason:'other',
 }));
}

function safeEnumList(values,allowed,limit=20){
 return (Array.isArray(values)?values:[]).slice(0,limit).map(value=>allowed.has(value)?value:'other');
}

function capturePredicateDiagnostics(state,timerBefore){
 if(!state)return {observationAvailable:false};
 return {
  observationAvailable:true,
  normalMode:state.normalModeSelected===true,
  timerAdvanced:state.timerAdvanced===true,
  unlimitedTimerLabel:state.unlimitedTimerLabel===true,
  homeHidden:state.homeHidden===true,
  hudVisible:state.hudVisible===true,
  resultHidden:state.resultHidden===true,
  loadingHidden:state.loadingHidden===true,
  errorHidden:state.errorHidden===true,
  pauseHidden:state.pauseHidden===true,
  documentHidden:state.documentHidden===true,
  documentHasFocus:state.documentHasFocus===true,
  activeElementCategory:SAFE_ACTIVE_ELEMENTS.has(state.activeElementCategory)?state.activeElementCategory:'other',
  pauseReasonCategory:SAFE_PAUSE_REASONS.has(state.pauseReasonCategory)?state.pauseReasonCategory:'unknown',
  lifecycleEvents:safeEnumList(state.lifecycleEvents,SAFE_LIFECYCLE_EVENTS),
  lifecycleEventsTruncated:state.lifecycleEventsTruncated===true,
  canvasDimensionsValid:state.canvasWidth>=320&&state.canvasHeight>=240,
  drawCallsObserved:state.drawCalls>0,
  pixelReadAttempted:state.renderSampled===true,
  pixelReadSucceeded:state.renderSampleSucceeded===true,
  renderedPixelsNonFlat:state.sampledColors?.length>=5&&state.distinctColors>1,
 };
}

function writeFailureArtifacts({diagnostics,screenshot,outputDir=FAILURE_ARTIFACT_DIR}){
 const diagnosticsPath=path.join(outputDir,path.basename(FAILURE_DIAGNOSTICS_PATH));
 const screenshotPath=path.join(outputDir,path.basename(FAILURE_SCREENSHOT_PATH));
 fs.mkdirSync(outputDir,{recursive:true});
 fs.writeFileSync(diagnosticsPath,`${JSON.stringify(diagnostics,null,2)}\n`,{flag:'wx'});
 if(Buffer.isBuffer(screenshot)&&screenshot.length>0)fs.writeFileSync(screenshotPath,screenshot,{flag:'wx'});
 return {diagnosticsPath,screenshotPath};
}

function safeErrorName(value){
 const name=typeof value==='string'?value:value?.name;
 return SAFE_ERROR_NAMES.has(name)?name:'OtherError';
}

function classifyFailure(value){
 const text=String(value?.message??value??'').toLowerCase();
 if(/timeout|timed out|exceeded/.test(text))return 'timeout';
 if(/webgl|shader|canvas|renderer|draw/.test(text))return 'render';
 if(/fetch|network|request|websocket|http/.test(text))return 'network';
 if(/storage|quota/.test(text))return 'storage';
 if(/assert|expected|actual/.test(text))return 'assertion';
 return 'other';
}

function boundedInteger(value,maximum=100000){
 const number=Number(value);
 return Number.isFinite(number)?Math.max(0,Math.min(maximum,Math.trunc(number))):0;
}

function safeTimer(value){
 return typeof value==='string'&&/^\d{1,2}:\d{2}$/.test(value)?value:null;
}

function safeColor(value){
 let parts;
 if(Array.isArray(value)&&value.length===3)parts=value;
 else if(typeof value==='string'){
  const match=/^(\d{1,3}),(\d{1,3}),(\d{1,3})$/.exec(value);
  if(match)parts=match.slice(1);
 }
 if(!parts)return null;
 const numbers=parts.map(part=>Number(part));
 return numbers.every(number=>Number.isInteger(number)&&number>=0&&number<=255)?numbers:null;
}

function projectGameplayState(state,timerBefore){
 if(!state||typeof state!=='object')return null;
 const currentTimer=safeTimer(state.timer),previousTimer=safeTimer(timerBefore);
 const colors=Array.isArray(state.sampledColors)?state.sampledColors.slice(0,15).map(safeColor).filter(Boolean):[];
 const timerLabel=state.timerLabel==='経過（無制限）'||state.timerLabel==='残り時間';
 return {
  normalModeSelected:state.mode==='normal',
  timerAdvanced:currentTimer!==null&&previousTimer!==null&&currentTimer!==previousTimer,
  unlimitedTimerLabel:state.timerLabel==='経過（無制限）',
  knownTimerLabel:timerLabel,
  homeHidden:state.homeVisible===false,
  hudVisible:state.hudVisible===true,
  resultHidden:state.resultVisible===false,
  loadingHidden:state.loadingVisible===false,
  errorHidden:state.errorVisible===false,
  pauseHidden:state.pauseVisible===false,
  documentHidden:state.documentHidden===true,
  documentHasFocus:state.documentHasFocus===true,
  activeElementCategory:SAFE_ACTIVE_ELEMENTS.has(state.activeElementCategory)?state.activeElementCategory:'other',
  pauseReasonCategory:SAFE_PAUSE_REASONS.has(state.pauseReasonCategory)?state.pauseReasonCategory:'unknown',
  lifecycleEvents:safeEnumList(state.lifecycleEvents,SAFE_LIFECYCLE_EVENTS),
  lifecycleEventsTruncated:state.lifecycleEventsTruncated===true,
  canvasWidth:boundedInteger(state.canvasWidth,10000),
  canvasHeight:boundedInteger(state.canvasHeight,10000),
  drawCalls:boundedInteger(state.drawCalls),
  frames:boundedInteger(state.frames),
  lastDrawFrame:boundedInteger(state.lastDrawFrame),
  sampledAtFrame:boundedInteger(state.sampledAtFrame),
  sampledAtDrawCalls:boundedInteger(state.sampledAtDrawCalls),
  sampleAttempts:boundedInteger(state.sampleAttempts,8),
  drawingBufferWidth:boundedInteger(state.drawingBufferWidth,10000),
  drawingBufferHeight:boundedInteger(state.drawingBufferHeight,10000),
  renderArmed:state.renderArmed===true,
  renderSampled:state.renderSampled===true,
  renderSampleSucceeded:state.renderSampleSucceeded===true,
  sampleErrorCategory:state.sampleErrorOccurred===true?'render':'none',
  sampledColors:colors,
  distinctColors:boundedInteger(state.distinctColors,15),
 };
}

function formatFailureSummary(error){
 return `Faito capture failed (${safeErrorName(error?.name)}/${classifyFailure(error?.message??error)}); check sanitized failure artifacts if available.`;
}

async function createLocalCaptureSession({chromiumImplementation}={}){
 return prepareBrowserCheck({
  env:{GAME_URL:DEFAULT_GAME_URL,START_TEST_SERVER:'1'},
  chromium:chromiumImplementation,
  startTestServer:startLocalVitePreviewServer,
 });
}

/** Test-only instrumentation reads at most eight distinct gameplay frames until a non-flat sample. */
function installGameplayRenderInstrumentation(){
 const stats={drawCalls:0,frames:0,lastDrawFrame:0,sampledAtFrame:0,sampledAtDrawCalls:0,
  drawingBufferWidth:0,drawingBufferHeight:0,sampleAttempts:0,lastSampleFrameTime:null,sampleErrorName:'',sampleSucceeded:false,
  sampledColors:[],distinctColors:0,sampled:false,armed:false,gl:null,reset(){
  this.drawCalls=0;this.frames=0;this.lastDrawFrame=0;this.sampledAtFrame=0;this.sampledAtDrawCalls=0;
  this.drawingBufferWidth=0;this.drawingBufferHeight=0;this.sampleAttempts=0;this.lastSampleFrameTime=null;this.sampleErrorName='';this.sampleSucceeded=false;
  this.sampledColors=[];this.distinctColors=0;this.sampled=false;this.armed=true;this.gl=null;
 }};
 stats.lifecycleEvents=[];stats.lifecycleEventsTruncated=false;
 const recordLifecycleEvent=event=>{
  if(stats.lifecycleEvents.length<20)stats.lifecycleEvents.push(event);
  else stats.lifecycleEventsTruncated=true;
 };
 window.addEventListener('blur',()=>recordLifecycleEvent('window-blur'),true);
 window.addEventListener('focus',()=>recordLifecycleEvent('window-focus'),true);
 window.addEventListener('pagehide',()=>recordLifecycleEvent('window-pagehide'),true);
 window.addEventListener('pageshow',()=>recordLifecycleEvent('window-pageshow'),true);
 document.addEventListener('visibilitychange',()=>recordLifecycleEvent(document.hidden?'document-hidden':'document-visible'),true);
 Object.defineProperty(window,'__faitoCaptureRenderStats',{configurable:false,value:stats});
 const prototypes=new Set([window.WebGL2RenderingContext?.prototype,window.WebGLRenderingContext?.prototype].filter(Boolean));
 for(const prototype of prototypes){
  for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','drawRangeElements']){
   const original=prototype[method];
   if(typeof original!=='function')continue;
   Object.defineProperty(prototype,method,{configurable:true,writable:true,value:function(...args){
    stats.drawCalls++;stats.lastDrawFrame=stats.frames+1;stats.gl=this;return Reflect.apply(original,this,args);
   }});
  }
 }
 const requestFrame=window.requestAnimationFrame.bind(window);
 window.requestAnimationFrame=function(callback){
  return requestFrame(time=>{
   callback(time);stats.frames++;
   if(stats.armed&&!stats.sampled&&stats.drawCalls>0&&stats.gl&&stats.lastSampleFrameTime!==time){
    stats.lastSampleFrameTime=time;
    try{
     const gl=stats.gl,width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
     if(typeof gl.isContextLost==='function'&&gl.isContextLost()){
      stats.sampled=true;stats.sampleErrorName='ContextLostError';return;
     }
     stats.sampleAttempts++;
     stats.sampledAtFrame=stats.frames;
     stats.sampledAtDrawCalls=stats.drawCalls;
     stats.drawingBufferWidth=width;stats.drawingBufferHeight=height;
     const positions=[.1,.3,.5,.7,.9].flatMap(x=>[.2,.5,.8].map(y=>[Math.floor(width*x),Math.floor(height*y)]));
     stats.sampledColors=positions.map(([x,y])=>{
      const pixel=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return `${pixel[0]},${pixel[1]},${pixel[2]}`;
     });
     stats.distinctColors=new Set(stats.sampledColors).size;
     stats.sampleSucceeded=true;
     if(stats.distinctColors>1||stats.sampleAttempts>=8)stats.sampled=true;
    }catch(error){stats.sampled=true;stats.sampleErrorName=error?.name??'Error';stats.sampleSucceeded=false;stats.sampledColors=[];stats.distinctColors=0;}
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
 const ready=mode==='normal'&&timer!==timerBefore&&timerLabel.includes('無制限')
  &&!visible('#home')&&visible('#hud')&&!visible('#result')&&!visible('#loading')
  &&!visible('#error-screen')
  &&canvas?.width>=320&&canvas?.height>=240&&stats?.drawCalls>0&&stats?.sampled
  &&stats?.distinctColors>1;
 return ready?(visible('#pause-screen')?'paused':'active'):false;
}

function readGameplayState(){
 const visible=id=>{const element=document.querySelector(id);return !!element&&!element.hidden;};
 const canvas=document.querySelector('#flight');
 const pauseVisible=visible('#pause-screen');
 const pauseNote=document.querySelector('#pause-note')?.textContent??'';
 const activeElement=document.activeElement;
 const activeElementCategory=activeElement===canvas?'canvas':activeElement===document.body?'body'
  :activeElement?.tagName==='BUTTON'?'button':activeElement?.tagName==='INPUT'?'input'
  :activeElement?.tagName==='SELECT'?'select':'other';
 const pauseReasonCategory=!pauseVisible?'none':pauseNote.includes('画面の更新が止まった')?'slow'
  :pauseNote.includes('描画を復旧')?'context':pauseNote.includes('準備ができたら')?'standard-pause':'unknown';
 const stats=window.__faitoCaptureRenderStats??{};
 return {
  mode:document.querySelector('input[name="game-mode"]:checked')?.value??null,
  timer:document.querySelector('#timer')?.textContent?.trim()??'',
  timerLabel:document.querySelector('#timer-label')?.textContent??'',
  homeVisible:visible('#home'),hudVisible:visible('#hud'),resultVisible:visible('#result'),
  loadingVisible:visible('#loading'),errorVisible:visible('#error-screen'),pauseVisible,
  documentHidden:document.hidden===true,documentHasFocus:typeof document.hasFocus==='function'&&document.hasFocus()===true,
  activeElementCategory,pauseReasonCategory,
  lifecycleEvents:stats.lifecycleEvents??[],lifecycleEventsTruncated:stats.lifecycleEventsTruncated===true,
  canvasWidth:canvas?.width??0,canvasHeight:canvas?.height??0,
  drawCalls:stats.drawCalls??0,frames:stats.frames??0,
  lastDrawFrame:stats.lastDrawFrame??0,sampledAtFrame:stats.sampledAtFrame??0,sampledAtDrawCalls:stats.sampledAtDrawCalls??0,
  sampleAttempts:stats.sampleAttempts??0,
  drawingBufferWidth:stats.drawingBufferWidth??0,drawingBufferHeight:stats.drawingBufferHeight??0,
  renderArmed:stats.armed===true,renderSampled:stats.sampled===true,renderSampleSucceeded:stats.sampleSucceeded===true,
  sampleErrorOccurred:typeof stats.sampleErrorName==='string'&&stats.sampleErrorName.length>0,
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

function rememberBrowserError(target,record){
 if(target.length<10)target.push(record);
}

function attachBrowserErrorListeners(page,diagnostics){
 if(typeof page.on!=='function')return;
 page.on('console',message=>{
  let type='unknown';
  try{type=message.type();}catch{}
  if(type==='error'){
   let text='';
   try{text=message.text();}catch{}
   rememberBrowserError(diagnostics.consoleErrors,{type:'console-error',category:classifyFailure(text)});
  }
 });
 page.on('pageerror',error=>rememberBrowserError(diagnostics.pageErrors,{
  name:safeErrorName(error?.name),category:classifyFailure(error?.message??error?.name),
 }));
}

async function collectFailureDiagnostics({page,network,stage,timerBefore,anonymousVerified,error,browserErrors,screenshotStatus,resumeClicks=0,pauseRecovery=null}){
 let rawState=null,observationError=null;
 try{rawState=await page.evaluate(readGameplayState);}catch(observationFailure){observationError={name:safeErrorName(observationFailure?.name),category:classifyFailure(observationFailure?.message??observationFailure?.name)};}
 const state=projectGameplayState(rawState,timerBefore);
 let rawUrl='';
 try{rawUrl=typeof page.url==='function'?page.url():'';}catch{}
 return {
  schema:'faito-capture-failure-v1',
  kind:'capture-failure',
  observedAt:new Date().toISOString(),
  stage:SAFE_STAGES.has(stage)?stage:'unknown',
  anonymousInputVerifiedEmpty:anonymousVerified===true,
  resumeClicks:boundedInteger(resumeClicks,1),
  pauseRecovery:pauseRecovery&&typeof pauseRecovery==='object'?{
   reasonCategory:SAFE_PAUSE_REASONS.has(pauseRecovery.reasonCategory)?pauseRecovery.reasonCategory:'unknown',
   documentHidden:pauseRecovery.documentHidden===true,
   documentHasFocus:pauseRecovery.documentHasFocus===true,
   activeElementCategory:SAFE_ACTIVE_ELEMENTS.has(pauseRecovery.activeElementCategory)?pauseRecovery.activeElementCategory:'other',
   lifecycleEvents:safeEnumList(pauseRecovery.lifecycleEvents,SAFE_LIFECYCLE_EVENTS),
  }:null,
  error:{name:safeErrorName(error?.name),category:classifyFailure(error?.message??error)},
  page:safeLocation(rawUrl),
  predicates:capturePredicateDiagnostics(state),
  state,
  observationError:observationError||null,
  network:{
   unexpectedCount:Array.isArray(network?.unexpected)?network.unexpected.length:0,
   unexpectedTruncated:Array.isArray(network?.unexpected)&&network.unexpected.length>50,
   unexpected:safeUnexpectedEvents(network?.unexpected),
   mockedRpcCalls:(Array.isArray(network?.mockedRpcCalls)?network.mockedRpcCalls:[])
    .map(name=>name==='get_best_score_ranking'?'ranking-read':name==='start_faitofuraito_guest_play_v1'?'anonymous-start':null)
    .filter(Boolean),
   localStaticRequestCount:Array.isArray(network?.localStaticRequests)?network.localStaticRequests.length:0,
  },
  browserErrors:{
   consoleErrors:browserErrors.consoleErrors,
   consoleErrorsTruncated:browserErrors.consoleErrors.length>=10,
   pageErrors:browserErrors.pageErrors,
   pageErrorsTruncated:browserErrors.pageErrors.length>=10,
  },
  failureScreenshot:new Set(['not-attempted','captured','empty','failed']).has(screenshotStatus)?screenshotStatus:'other',
 };
}

async function captureGameplay({sessionFactory=createLocalCaptureSession,chromiumImplementation=chromium,captureWriter=writeCapture,failureArtifactWriter=writeFailureArtifacts}={}){
 let session,stage='opening-capture-session',timerBefore=null,anonymousVerified=false,resumeClicks=0,pauseRecovery=null;
 const browserErrors={consoleErrors:[],pageErrors:[]};
 try{
  session=await sessionFactory({chromiumImplementation});
  const {page,gameUrl,network}=session;
  attachBrowserErrorListeners(page,browserErrors);
  stage='setting-capture-viewport';
  await page.setViewportSize({width:1200,height:630});
  stage='installing-render-instrumentation';
  await page.addInitScript(installGameplayRenderInstrumentation);
  stage='navigating-to-local-preview';
  await page.goto(gameUrl.href);
  stage='waiting-for-home-and-engine';
  await page.locator('#home').waitFor({state:'visible'});
  await page.locator('#error-screen').waitFor({state:'hidden'});
  stage='selecting-anonymous-normal-mode';
  await page.locator('input[name="game-mode"][value="normal"]').check();
  await page.locator('#pilot-name').fill('');
  anonymousVerified=await page.locator('#pilot-name').inputValue()==='';
  assert.equal(anonymousVerified,true,'capture must use anonymous play');
  assert.equal(await page.locator('input[name="game-mode"]:checked').inputValue(),'normal','capture must use normal mode');
  timerBefore=await page.locator('#timer').innerText();
  stage='starting-anonymous-normal-gameplay';
  await page.locator('#start').click();
  await page.evaluate(()=>window.__faitoCaptureRenderStats.reset());
  stage='waiting-for-active-normal-gameplay';
  const gameplayDeadline=Date.now()+15000;
  const waitForGameplayStatus=async()=>{
   const remaining=gameplayDeadline-Date.now();
   if(remaining<=0)throw new Error('Normal gameplay readiness timed out.');
   const handle=await page.waitForFunction(waitForActiveNormalGameplay,timerBefore,{timeout:remaining});
   try{return await handle.jsonValue();}finally{await handle.dispose();}
  };
  let gameplayStatus=await waitForGameplayStatus();
  if(gameplayStatus==='paused'){
   stage='recovering-normal-gameplay-pause';
   const pausedState=projectGameplayState(await page.evaluate(readGameplayState),timerBefore);
   pauseRecovery=pausedState?{
    reasonCategory:pausedState.pauseReasonCategory,
    documentHidden:pausedState.documentHidden,
    documentHasFocus:pausedState.documentHasFocus,
    activeElementCategory:pausedState.activeElementCategory,
    lifecycleEvents:pausedState.lifecycleEvents,
   }:{reasonCategory:'unknown',documentHidden:false,documentHasFocus:false,activeElementCategory:'other',lifecycleEvents:[]};
   assert.equal(pausedState?.normalModeSelected,true,'pause recovery requires normal mode');
   assert.equal(pausedState?.homeHidden,true,'pause recovery requires gameplay, not the home screen');
   assert.equal(pausedState?.resultHidden,true,'pause recovery must happen before the result screen');
   assert.equal(pausedState?.errorHidden,true,'pause recovery cannot bypass an engine error');
   await page.bringToFront();
   const resumeButton=page.locator('#resume');
   if(!await resumeButton.isEnabled())throw new Error('Normal gameplay pause cannot be resumed.');
   const resumeTimeout=gameplayDeadline-Date.now();
   if(resumeTimeout<=0)throw new Error('Normal gameplay pause recovery timed out.');
   await resumeButton.click({timeout:resumeTimeout});
   resumeClicks=1;
   gameplayStatus=await waitForGameplayStatus();
  }
  assert.equal(gameplayStatus,'active','normal gameplay must be actively resumed before capture');

  stage='validating-live-gameplay';
  const state=await page.evaluate(readGameplayState);
  assertActiveNormalGameplay(state,timerBefore);
  assertNetworkGuard(network);
  stage='capturing-anonymous-gameplay-frame';
  const png=await page.screenshot({type:'png',fullPage:false});
  assert(Buffer.isBuffer(png)&&png.length>0,'browser screenshot must be returned as PNG bytes before acceptance');

  stage='revalidating-live-gameplay-after-screenshot';
  const afterCapture=await page.evaluate(readGameplayState);
  assertActiveNormalGameplay(afterCapture,timerBefore);
  assertNetworkGuard(network);
  stage='writing-approved-capture';
  captureWriter(png);
  return {
   capture:'success',viewport:{width:1200,height:630},mode:'normal',phase:'playing',
   resumeClicks,
   pauseRecovery,
   render:{calls:boundedInteger(state.drawCalls),frames:boundedInteger(state.frames),distinctColors:boundedInteger(state.distinctColors,15)},
   localMocks:network.mockedRpcCalls.map(name=>name==='get_best_score_ranking'?'ranking-read':name==='start_faitofuraito_guest_play_v1'?'anonymous-start':'other'),
  };
 }catch(error){
  if(session?.page){
   let screenshot=null,screenshotStatus='not-attempted';
   if(anonymousVerified&&typeof session.page.screenshot==='function'){
    try{
     screenshot=await session.page.screenshot({type:'png',fullPage:false,timeout:5000});
     screenshotStatus=Buffer.isBuffer(screenshot)&&screenshot.length>0?'captured':'empty';
    }catch{screenshotStatus='failed';}
   }
   const diagnostics=await collectFailureDiagnostics({page:session.page,network:session.network,stage,timerBefore,anonymousVerified,error,browserErrors,screenshotStatus,resumeClicks,pauseRecovery});
   try{failureArtifactWriter({diagnostics,screenshot:Buffer.isBuffer(screenshot)&&screenshot.length>0?screenshot:null});}
   catch(artifactError){console.error(`Could not preserve Faito capture failure diagnostics (${safeErrorName(artifactError?.name)}/${classifyFailure(artifactError?.message??artifactError)}).`);}
  }
  throw error;
 }finally{
  await closeLocalBrowserCheckSession(session);
 }
}

if(require.main===module){
 captureGameplay().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(formatFailureSummary(error));process.exitCode=1;});
}

module.exports={CAPTURE_PATH,FAILURE_DIAGNOSTICS_PATH,FAILURE_SCREENSHOT_PATH,installGameplayRenderInstrumentation,waitForActiveNormalGameplay,readGameplayState,assertActiveNormalGameplay,capturePredicateDiagnostics,projectGameplayState,formatFailureSummary,collectFailureDiagnostics,writeFailureArtifacts,captureGameplay};
