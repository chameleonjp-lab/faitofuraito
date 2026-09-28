/* Run against `npm run dev` with Playwright installed in the verification environment.
   BROWSER_EXECUTABLE can select an available Chromium; no test state injection is used. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
let browser,server;
(async()=>{
 if(process.env.START_TEST_SERVER){server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('Local:'))resolve()});server.on('exit',code=>reject(new Error('Server exit '+code)));setTimeout(()=>reject(new Error('Server timeout')),10000).unref();});}
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:1,hasTouch:true,isMobile:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173/');
 await page.locator('#home').waitFor({state:'visible'});await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('#error-screen').isVisible(),false);
 fs.mkdirSync('evidence',{recursive:true});await page.screenshot({path:'evidence/home-393.png'});
 await page.fill('#pilot-name','検査パイロット');await page.click('#start');
 await page.waitForFunction(()=>window.flightSnapshot?.().elapsed>.3);
 await page.screenshot({path:'evidence/flight-393.png'});
 const initial=await page.evaluate(()=>window.flightSnapshot());
 await page.evaluate(()=>{window.testTouches=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])document.addEventListener(type,e=>window.testTouches.push({type,id:e.pointerId,target:e.target.id,x:e.clientX,y:e.clientY,time:e.timeStamp}));});
 const client=await page.context().newCDPSession(page);
 const touch=async(type,points,timestamp)=>client.send('Input.dispatchTouchEvent',{type,...(timestamp?{timestamp}:{}),touchPoints:points.map(([id,x,y])=>({id,x,y,force:1,radiusX:4,radiusY:4}))});
 // Real multi-touch: one pointer steers while the other holds fire.
 await touch('touchStart',[[1,130,450]]);await touch('touchMove',[[1,170,440]]);
 await touch('touchStart',[[1,170,440],[2,316,727]]);
 await page.waitForFunction(n=>window.flightSnapshot().shots>=n+4,initial.shots);
 await touch('touchEnd',[]);
 const released=await page.evaluate(()=>window.flightSnapshot());
 await page.waitForFunction(t=>window.flightSnapshot().elapsed>t+.25,released.elapsed);
 const afterRelease=await page.evaluate(()=>window.flightSnapshot());
 assert.equal(afterRelease.shots,released.shots,'releasing the touches stops firing');
 assert.notDeepEqual(afterRelease.player.quaternion,initial.player.quaternion,'steering changes orientation');
 // Fast upward stroke through the normal input surface, not an internal command.
 const swipeTime=Date.now()/1000;
 await touch('touchStart',[[3,180,570]],swipeTime);
 await touch('touchMove',[[3,180,430]],swipeTime+.12);
 await touch('touchEnd',[],swipeTime+.16);
 await page.waitForFunction(()=>window.flightSnapshot().player.loopProgress>0,null,{timeout:5000});
 await page.screenshot({path:'evidence/loop-393.png'});
 await page.waitForFunction(()=>window.flightSnapshot().loops===1,null,{timeout:20000});
 await page.click('#pause');
 const paused=await page.evaluate(()=>window.flightSnapshot());
 await page.waitForTimeout(180);assert.equal((await page.evaluate(()=>window.flightSnapshot())).elapsed,paused.elapsed);
 await page.click('#resume');await page.waitForFunction(t=>window.flightSnapshot().elapsed>t,paused.elapsed);
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 await page.locator('#pause-screen').waitFor({state:'visible'});
 await page.click('#quit');await page.locator('#home').waitFor({state:'visible'});
 for(const [width,height] of [[320,568],[393,650],[852,393]]){
  await page.setViewportSize({width,height});
  await page.screenshot({path:`evidence/home-${width}x${height}.png`});
  await page.locator('#start').scrollIntoViewIfNeeded();
  const box=await page.locator('#start').boundingBox();assert(box&&box.width>=44&&box.height>=44);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 await page.setViewportSize({width:393,height:852});
 await page.evaluate(()=>document.documentElement.style.fontSize='32px');
 await page.locator('#start').scrollIntoViewIfNeeded();await page.screenshot({path:'evidence/text-200.png'});
 assert.equal(await page.locator('#start').isVisible(),true);await page.evaluate(()=>document.documentElement.style.fontSize='');
 await page.click('#about-open');await page.locator('#about').waitFor({state:'visible'});await page.locator('#about-close').scrollIntoViewIfNeeded();await page.click('#about-close');
 // Complete a flight through the actual fire control, then retry from its result.
 await page.locator('#start').scrollIntoViewIfNeeded();await page.click('#start');
 await page.waitForFunction(()=>window.flightSnapshot().elapsed>.2);
 await touch('touchStart',[[4,316,727]]);
 const slowPauses=[];
 // Software rendering can stall for >1s when a cached view is resized. The
 // game deliberately pauses; exercise the same explicit resume as a player.
 for(let attempt=0;attempt<4;attempt++){
  await page.waitForFunction(()=>['ended','paused'].includes(window.flightSnapshot().phase),null,{timeout:120000});
  if((await page.evaluate(()=>window.flightSnapshot())).phase==='ended')break;
  slowPauses.push(await page.locator('#pause-note').innerText());
  assert(slowPauses.at(-1).includes('画面の更新'),'only an observed render stall may be resumed');
  await touch('touchEnd',[]);await page.click('#resume');
  await touch('touchStart',[[5+attempt,316,727]]);
 }
 await page.locator('#result').waitFor({state:'visible',timeout:5000});
 await touch('touchEnd',[]);
 const ended=await page.evaluate(()=>window.flightSnapshot());
 assert.equal(ended.phase,'ended');assert(ended.shots>0&&ended.shots<=1120);
 assert(['time','ammo','shot-down'].includes(ended.endReason));
 assert.equal((await page.locator('#result-score').innerText()).replaceAll(',',''),String(ended.score));
 await page.screenshot({path:'evidence/result-393.png'});
 await page.click('#retry');await page.waitForFunction(()=>window.flightSnapshot().elapsed>.2);
 const restarted=await page.evaluate(()=>window.flightSnapshot());
 assert.equal(restarted.shots,0);assert.equal(restarted.kills,0);assert.equal(restarted.loops,0);
 assert.equal(restarted.player.mg,1000);assert.equal(restarted.player.cannon,120);
 assert(restarted.render.geometries<=initial.render.geometries+4,'replaying reuses aircraft geometry');
 await page.click('#pause');await page.click('#quit');
 assert.deepEqual(errors,[],'no page or WebGL shader errors');
 const result={status:'pass',browser:await browser.version(),screens:['393x852','320x568','393x650','852x393'],initial,afterRelease,paused,ended,restarted,slowPauses,errors};
 fs.writeFileSync('evidence/browser-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,browser:result.browser,checks:'start / real multi-touch steer+fire / release / swipe loop / pause+resume / blur / viewport / enlarged text / about / result / retry / geometry reuse',errors}));
 await browser.close();
})().catch(async e=>{console.error(e);if(browser){try{console.error(await browser.contexts()[0]?.pages()[0]?.evaluate(()=>({events:window.testTouches,state:window.flightSnapshot?.()})));await browser.contexts()[0]?.pages()[0]?.screenshot({path:'evidence/failure.png'});}catch{}}process.exitCode=1;}).finally(async()=>{await browser?.close();server?.kill();});
