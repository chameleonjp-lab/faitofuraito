/* One local, anonymous, live-engine screenshot. Never runs a completed game or submits a score. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {createLocalBrowserCheckSession,closeLocalBrowserCheckSession}=require('./browser-check.cjs');

const CAPTURE_PATH=path.resolve(__dirname,'../evidence/faito-share-gameplay-capture.png');
const ALLOWED_MOCKS=new Set(['get_best_score_ranking','start_faitofuraito_guest_play_v1']);

function writeCapture(buffer){
 fs.mkdirSync(path.dirname(CAPTURE_PATH),{recursive:true});
 fs.writeFileSync(CAPTURE_PATH,buffer,{flag:'wx'});
}

function assertActiveNormalSnapshot(snapshot){
 if(!snapshot||snapshot.mode!=='normal'||snapshot.phase!=='playing'||snapshot.elapsed<0.5
   ||!Array.isArray(snapshot.enemies)||snapshot.enemies.length===0
   ||!snapshot.render||snapshot.render.calls<1||snapshot.render.triangles<1){
  throw new Error('Gameplay capture requires an active normal-mode engine frame with a visible enemy and rendered triangles.');
 }
 return snapshot;
}

function assertLiveGameplaySurfaces(surfaces){
 assert.equal(surfaces.homeVisible,false,'home must be hidden');
 assert.equal(surfaces.hudVisible,true,'live HUD must be visible');
 assert.equal(surfaces.resultVisible,false,'result screen must remain hidden');
 assert.equal(surfaces.loadingVisible,false,'loading screen must be hidden');
 assert.equal(surfaces.errorVisible,false,'engine error screen must be hidden');
 assert(surfaces.canvasWidth>=320&&surfaces.canvasHeight>=240,'game canvas must have rendered dimensions');
}

function assertNetworkGuard(network){
 assert.deepEqual(network.unexpected,[],'capture blocked every unmocked request, redirect, popup, and WebSocket');
 assert(Array.isArray(network.mockedRpcCalls)&&network.mockedRpcCalls.includes('start_faitofuraito_guest_play_v1'),'the anonymous start was locally mocked');
 assert(network.mockedRpcCalls.every(operation=>ALLOWED_MOCKS.has(operation)),'only local ranking reads and anonymous start were mocked');
}

async function captureGameplay({sessionFactory=createLocalBrowserCheckSession,chromiumImplementation=chromium,captureWriter=writeCapture}={}){
 let session;
 try{
  session=await sessionFactory({chromiumImplementation});
  const {page,gameUrl,network}=session;
  await page.setViewportSize({width:1200,height:630});
  await page.goto(gameUrl.href);
  await page.locator('#home').waitFor({state:'visible'});
  await page.locator('#error-screen').waitFor({state:'hidden'});
  await page.locator('input[name="game-mode"][value="normal"]').check();
  await page.locator('#pilot-name').fill('');
  assert.equal(await page.locator('#pilot-name').inputValue(),'','capture must use an anonymous play');
  await page.locator('#start').click();
  await page.waitForFunction(()=>{
   const state=window.flightSnapshot?.();
   return state?.mode==='normal'&&state.phase==='playing'&&state.elapsed>=0.5
    &&state.enemies?.length>0&&state.render?.calls>0&&state.render?.triangles>0;
  },null,{timeout:15000});

  const snapshot=assertActiveNormalSnapshot(await page.evaluate(()=>window.flightSnapshot?.()));
  const surfaces=await page.evaluate(()=>({
   homeVisible:!document.querySelector('#home')?.hidden,
   hudVisible:!document.querySelector('#hud')?.hidden,
   resultVisible:!document.querySelector('#result')?.hidden,
   loadingVisible:!document.querySelector('#loading')?.hidden,
   errorVisible:!document.querySelector('#error-screen')?.hidden,
   canvasWidth:document.querySelector('#flight')?.width||0,
   canvasHeight:document.querySelector('#flight')?.height||0,
  }));
  assertLiveGameplaySurfaces(surfaces);
  assertNetworkGuard(network);
  const png=await page.screenshot({type:'png',fullPage:false});
  assert(Buffer.isBuffer(png),'browser screenshot must be returned as PNG bytes before acceptance');

  const afterCapture=assertActiveNormalSnapshot(await page.evaluate(()=>window.flightSnapshot?.()));
  assert.equal(afterCapture.phase,'playing','the page is closed before result or score submission');
  assert.equal(await page.locator('#result').isVisible(),false);
  assertNetworkGuard(network);
  captureWriter(png);
  return {path:CAPTURE_PATH,viewport:{width:1200,height:630},mode:snapshot.mode,phase:snapshot.phase,elapsed:snapshot.elapsed,enemies:snapshot.enemies.length,render:snapshot.render,localMocks:network.mockedRpcCalls};
 }finally{
  await closeLocalBrowserCheckSession(session);
 }
}

if(require.main===module){
 captureGameplay().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
}

module.exports={CAPTURE_PATH,assertActiveNormalSnapshot,assertLiveGameplaySurfaces,assertNetworkGuard,captureGameplay};
