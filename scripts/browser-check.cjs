/* UI regression against a local Vite server. No game-state injection. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
let browser,server;
(async()=>{
 if(process.env.START_TEST_SERVER){server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('Local:'))resolve()});server.on('exit',code=>reject(new Error('Server exit '+code)));setTimeout(()=>reject(new Error('Server timeout')),10000).unref();});}
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:393,height:852},deviceScaleFactor:Number(process.env.BROWSER_DPR||1),hasTouch:true,isMobile:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const snapshot=()=>page.evaluate(()=>window.flightSnapshot());
 const slowPauses=[];
 const ensureFlying=async()=>{if((await snapshot()).phase==='paused'){const note=await page.locator('#pause-note').innerText();assert(note.includes('画面の更新'),'only an observed rendering stall may resume automatically in this test');slowPauses.push(note);await page.click('#resume');await page.waitForFunction(()=>window.flightSnapshot().phase==='playing');}};
 const center=async selector=>{const b=await page.locator(selector).boundingBox();assert(b,selector+' has a box');return [b.x+b.width/2,b.y+b.height/2]};
 const rangeEnd=async(id,key)=>{await page.locator(id).press(key);return Number(await page.locator(id).inputValue())};
 const gameUrl=process.env.GAME_URL||'http://127.0.0.1:5173/';
 await page.goto(gameUrl);await page.locator('#home').waitFor({state:'visible'});await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('#error-screen').isVisible(),false);
 fs.mkdirSync('evidence',{recursive:true});await page.screenshot({path:'evidence/home-393.png'});
 // Configure all four controls using real selection/range keyboard input.
 await page.click('#home-controls');await page.locator('#control-settings').waitFor({state:'visible'});
 const settingsValues={};
 for(const id of ['fire','loop','accelerate','brake']){
  await page.selectOption('#control-target',id);
  const size=await rangeEnd('#control-size','Home');await page.locator('#control-size').press('ArrowRight');
  const opacity=await rangeEnd('#control-opacity','Home');
  settingsValues[id]={size:Number(await page.locator('#control-size').inputValue()),opacity};
 }
 // A placement at an edge must still keep the whole hit target inside the app.
 await page.selectOption('#control-target','fire');const savedX=await rangeEnd('#control-x','End'),savedY=await rangeEnd('#control-y','End');
 await page.screenshot({path:'evidence/settings-393.png'});await page.click('#control-save');
 await page.click('#home-controls');await page.selectOption('#control-target','fire');
 const savedSize=await page.locator('#control-size').inputValue();
 await rangeEnd('#control-size','End');await page.click('#control-cancel');
 await page.reload();await page.locator('#home').waitFor({state:'visible'});
 await page.click('#home-controls');await page.selectOption('#control-target','fire');
 assert.equal(await page.locator('#control-size').inputValue(),savedSize,'cancel and reload preserve the saved size');
 assert.equal(Number(await page.locator('#control-x').inputValue()),savedX);assert.equal(Number(await page.locator('#control-y').inputValue()),savedY);
 for(const id of ['fire','loop','accelerate','brake']){
  await page.selectOption('#control-target',id);
  assert.equal(Number(await page.locator('#control-size').inputValue()),settingsValues[id].size);
  assert.equal(Number(await page.locator('#control-opacity').inputValue()),settingsValues[id].opacity);
 }
 await page.click('#control-cancel');console.log('settings saved, cancelled and reloaded');
 // Clear only this test browser's app settings after checking persistence,
 // so the remaining gameplay checks use the normal default button layout.
 await page.evaluate(()=>localStorage.removeItem('faitofuraito-controls-v1'));
 await page.reload();await page.locator('#home').waitFor({state:'visible'});
 await page.fill('#pilot-name','検査パイロット');await page.click('#start');
 await page.waitForFunction(()=>window.flightSnapshot?.().elapsed>.2);
 assert.equal(await page.locator('#sound').isVisible(),false);assert.equal(await page.locator('#pause-sound').isVisible(),false);
 assert((await page.locator('#timer').innerText()).startsWith('4:')||(await page.locator('#timer').innerText())==='5:00');
 const initial=await snapshot();
 await page.evaluate(()=>{window.testTouches=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])document.addEventListener(type,e=>window.testTouches.push({type,id:e.pointerId,target:e.target.id,x:e.clientX,y:e.clientY,time:e.timeStamp}));});
 const client=await page.context().newCDPSession(page);
 const touch=async(type,points)=>client.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,force:1,radiusX:4,radiusY:4}))});
 await ensureFlying();await touch('touchStart',[[1,120,430]]);assert((await page.locator('#joystick').getAttribute('class')||'').includes('visible'));
 await touch('touchMove',[[1,151,420]]);
 const fire=await center('#fire');await touch('touchStart',[[1,151,420],[2,...fire]]);
 await page.waitForFunction(n=>window.flightSnapshot().shots>=n+4,initial.shots);
 // Cancel just the steering pointer; the other pointer must keep firing.
 await page.locator('#flight').dispatchEvent('pointercancel',{pointerId:(await page.evaluate(()=>window.testTouches.find(e=>e.target==='flight'&&e.type==='pointerdown').id)),pointerType:'touch'});
 const oneReleased=await snapshot();await page.waitForFunction(n=>window.flightSnapshot().shots>n,oneReleased.shots);
 await touch('touchEnd',[]);const released=await snapshot();
 await page.waitForFunction(t=>window.flightSnapshot().elapsed>t+.2,released.elapsed);
 const afterRelease=await snapshot();assert.equal(afterRelease.shots,released.shots);assert(!(await page.locator('#joystick').getAttribute('class')||'').includes('visible'));
 assert.notDeepEqual(afterRelease.player.quaternion,initial.player.quaternion);
 const accel=await center('#accelerate'),beforeAccel=await snapshot();
 await touch('touchStart',[[3,...accel]]);await page.waitForFunction(s=>window.flightSnapshot().player.speed>s+4,beforeAccel.player.speed);await touch('touchEnd',[]);
 const accelerated=await snapshot();console.log('multi-touch, release and acceleration passed');
 await page.click('#loop');await page.waitForFunction(()=>window.flightSnapshot().player.loopProgress>0,null,{timeout:5000});
 await page.waitForFunction(()=>window.flightSnapshot().loops===1,null,{timeout:20000});
 const brake=await center('#brake'),beforeBrake=await snapshot();
 await touch('touchStart',[[4,...brake]]);await page.waitForFunction(s=>window.flightSnapshot().player.speed<s-3,beforeBrake.player.speed);await touch('touchEnd',[]);
 const braked=await snapshot();console.log('loop and braking passed');
 // An upward joystick stroke is ordinary pitch input and never triggers a loop.
 const beforeSwipe=braked.loops;await touch('touchStart',[[5,190,470]]);await touch('touchMove',[[5,190,370]]);await touch('touchEnd',[]);
 assert.equal((await snapshot()).player.loopProgress,0);assert.equal((await snapshot()).loops,beforeSwipe);
 await page.click('#pause');const paused=await snapshot();await page.click('#pause-controls');
 await page.locator('#control-settings').waitFor({state:'visible'});assert.equal((await snapshot()).elapsed,paused.elapsed);
 await page.click('#control-cancel');assert.equal((await snapshot()).phase,'paused');assert.equal((await snapshot()).elapsed,paused.elapsed);
 await page.click('#resume');await page.waitForFunction(t=>window.flightSnapshot().elapsed>t,paused.elapsed);
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.locator('#pause-screen').waitFor({state:'visible'});
 await page.click('#quit');await page.locator('#home').waitFor({state:'visible'});
 for(const [width,height] of [[320,568],[393,650],[852,393]]){
  await page.setViewportSize({width,height});await page.locator('#start').scrollIntoViewIfNeeded();
  const box=await page.locator('#start').boundingBox();assert(box&&box.width>=44&&box.height>=44);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.click('#home-controls');await page.locator('#control-save').scrollIntoViewIfNeeded();const save=await page.locator('#control-save').boundingBox();assert(save&&save.height>=44&&save.y+save.height<=height+1);
  await page.screenshot({path:`evidence/settings-${width}x${height}.png`});await page.click('#control-cancel');
 }
 await page.setViewportSize({width:393,height:852});await page.evaluate(()=>document.documentElement.style.fontSize='32px');
 await page.locator('#start').scrollIntoViewIfNeeded();assert.equal(await page.locator('#start').isVisible(),true);await page.evaluate(()=>document.documentElement.style.fontSize='');
 await page.locator('#start').scrollIntoViewIfNeeded();await page.click('#start');await page.waitForFunction(()=>window.flightSnapshot().elapsed>.2);
 await ensureFlying();const fire2=await center('#fire');await touch('touchStart',[[10,...fire2]]);
 // Keep the screenshot near a visible burst, then finish using the normal controls.
 await page.waitForFunction(()=>window.flightSnapshot().shots>=4);await page.screenshot({path:'evidence/flight-393.png'});
 for(let attempt=0;attempt<4;attempt++){
  await page.waitForFunction(()=>['ended','paused'].includes(window.flightSnapshot().phase),null,{timeout:120000});
  if((await snapshot()).phase==='ended')break;
  slowPauses.push(await page.locator('#pause-note').innerText());assert(slowPauses.at(-1).includes('画面の更新'));
  await touch('touchEnd',[]);await page.click('#resume');await touch('touchStart',[[11+attempt,...fire2]]);
 }
 await page.locator('#result').waitFor({state:'visible',timeout:5000});await touch('touchEnd',[]);
 const ended=await snapshot();assert.equal(ended.phase,'ended');assert(ended.shots>0&&ended.shots<=1120);assert(['time','ammo','shot-down'].includes(ended.endReason));
 assert.equal((await page.locator('#result-score').innerText()).replaceAll(',',''),String(ended.score));
 assert((await page.locator('#result-damage').innerText()).replaceAll(',','').includes(String(ended.damageTaken*10)));
 await page.screenshot({path:'evidence/result-393.png'});
 await page.setViewportSize({width:320,height:568});await page.locator('#home-button').scrollIntoViewIfNeeded();await page.click('#home-button');await page.locator('#home').waitFor({state:'visible'});
 await page.setViewportSize({width:393,height:852});await page.locator('#start').scrollIntoViewIfNeeded();await page.click('#start');await page.waitForFunction(()=>window.flightSnapshot().elapsed>.2);
 const restarted=await snapshot();assert.equal(restarted.shots,0);assert.equal(restarted.kills,0);assert.equal(restarted.loops,0);assert.equal(restarted.damageTaken,0);assert.equal(restarted.player.mg,1000);assert.equal(restarted.player.cannon,120);
 assert(restarted.render.geometries<=initial.render.geometries+8,'replaying reuses aircraft/effect geometry');await page.click('#pause');await page.click('#quit');
 assert.deepEqual(errors,[],'no page or WebGL shader errors');
 const result={status:'pass',browser:await browser.version(),screens:['393x852','320x568','393x650','852x393'],deviceScaleFactor:Number(process.env.BROWSER_DPR||1),settingsValues,initial,afterRelease,accelerated,braked,paused,ended,restarted,slowPauses,errors};
 fs.writeFileSync('evidence/browser-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,browser:result.browser,checks:'settings save/cancel/reload / joystick+fire multi-touch / pointer cancellation / accelerate+brake / dedicated loop / swipe does not loop / pause settings / blur / responsive layout / damage result / result to home / restart / resource reuse',errors}));
})().catch(async e=>{console.error(e);if(browser){try{console.error(await browser.contexts()[0]?.pages()[0]?.evaluate(()=>({events:window.testTouches,state:window.flightSnapshot?.(),pauseNote:document.querySelector('#pause-note')?.textContent})));await browser.contexts()[0]?.pages()[0]?.screenshot({path:'evidence/failure.png'});}catch{}}process.exitCode=1;}).finally(async()=>{await browser?.close();server?.kill();});
