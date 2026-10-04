import { test, expect } from '@playwright/test';
import { Euler, Quaternion, Vector3 } from 'three';
const snapshot = (page: any) => page.evaluate(() => (window as any).flightSnapshot());
async function aimUsingPointerUntilKill(page:any) {
  const box=await page.locator('#flight').boundingBox();
  const origin={x:box.x+box.width*.3,y:box.y+box.height*.5};
  await page.mouse.move(origin.x,origin.y);await page.mouse.down();
  let previous=await snapshot(page);
  for(let i=0;i<240;i++) {
    const s=await snapshot(page);if(s.kills>0)break;
    expect(s.phase).toBe('playing');
    const enemy=s.enemies.find((e:any)=>e.health>0);
    if(enemy){
      const pos=new Vector3().fromArray(enemy.position), player=new Vector3().fromArray(s.player.position);
      const prior=previous.enemies.find((e:any)=>e.id===enemy.id);
      const dt=s.elapsed-previous.elapsed;
      const velocity=prior&&dt>0?pos.clone().sub(new Vector3().fromArray(prior.position)).divideScalar(dt):new Vector3();
      const lead=pos.clone().sub(player).addScaledVector(velocity,pos.distanceTo(player)/850).normalize();
      const attitude=new Euler().setFromQuaternion(new Quaternion().fromArray(s.player.quaternion),'YXZ');
      const error=Math.atan2(Math.sin(Math.atan2(-lead.x,-lead.z)-attitude.y),Math.cos(Math.atan2(-lead.x,-lead.z)-attitude.y));
      const turn=Math.max(-1,Math.min(1,-error/.18)),climb=Math.max(-1,Math.min(1,Math.asin(lead.y)/.95));
      const length=Math.hypot(turn,climb),distance=36*(.08+.92*Math.min(1,length));
      await page.mouse.move(origin.x+(length?turn/length*distance:0),origin.y-(length?climb/length*distance:0));
    }
    previous=s;
    await page.waitForFunction(t=>(window as any).flightSnapshot().elapsed>=t+.1|| (window as any).flightSnapshot().phase!=='playing',s.elapsed);
  }
  await page.mouse.up();expect((await snapshot(page)).kills).toBeGreaterThan(0);
}
test.beforeEach(async ({page}) => {
  // All production network/leaderboard operations are replaced in this isolated context.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.fulfill({status:200,contentType:'application/json',body:'[]'}));
});
for (const mode of ['easy','normal']) test(`${mode}: actual HUD, steering recovery, pause, and saved controls`,async ({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#home')).toBeVisible();
  await page.locator(`input[name="game-mode"][value="${mode}"]`).check();
  await page.locator('#start').click();
  await page.waitForFunction(()=> (window as any).flightSnapshot?.().elapsed > .2);
  expect((await snapshot(page)).mode).toBe(mode);
  await expect(page.locator('#reticle')).toBeVisible();
  await expect(page.locator('#reticle')).toHaveCSS('border-top-width','1px');
  if(mode==='normal'){
    await page.keyboard.down('Space');
    await page.waitForFunction(()=>(window as any).flightSnapshot().bullets>0);
  }
  await page.screenshot({path:info.outputPath(`${mode}-hud.png`)});
  if(mode==='normal')await page.keyboard.up('Space');
  const canvas=page.locator('#flight');const box=await canvas.boundingBox();expect(box).not.toBeNull();
  const x=box!.x+box!.width*.35,y=box!.y+box!.height*.5;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+55,y-25);
  await expect(page.locator('#joystick')).toHaveClass(/visible/);
  await page.mouse.up();await expect(page.locator('#joystick')).not.toHaveClass(/visible/);
  await page.locator('#pause').click();const paused=await snapshot(page);
  await page.locator('#pause-controls').click();await expect(page.locator('#control-settings')).toBeVisible();await page.locator('#control-editor-touch').click();
  const ids=await page.locator('[id]').evaluateAll(nodes=>nodes.map(n=>n.id));expect(new Set(ids).size).toBe(ids.length);
  await page.screenshot({path:info.outputPath(`${mode}-settings.png`)});
  await page.locator('#control-cancel').click();expect((await snapshot(page)).elapsed).toBe(paused.elapsed);
  await page.locator('#resume').click();await page.waitForFunction(t=>(window as any).flightSnapshot().elapsed>t,paused.elapsed);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-40,y);
  await expect(page.locator('#joystick')).toHaveClass(/visible/);await page.mouse.up();
  expect(errors).toEqual([]);
});
for(const size of [{width:320,height:568},{width:852,height:393}]) test(`settings fit ${size.width}x${size.height}`,async({page},info)=>{
  await page.setViewportSize(size);await page.goto('/');await page.locator('#home-controls').click();
  await expect(page.locator('#control-settings')).toBeVisible();await page.locator('#control-editor-touch').click();
  const save=page.locator('#control-save');await save.scrollIntoViewIfNeeded();await expect(save).toBeInViewport();
  await page.screenshot({path:info.outputPath('settings.png')});
  await page.locator('#control-size').press('End');const sizeValue=await page.locator('#control-size').inputValue();await save.click();
  await page.locator('#home-controls').click();await expect(page.locator('#control-settings')).toBeVisible();await page.locator('#control-editor-touch').click();
  await expect(page.locator('#control-size')).toHaveValue(sizeValue);
  await page.locator('#control-cancel').click();await expect(page.locator('#home')).toBeVisible();
});
test('normal paired magazines reload through real firing input, freeze on pause, and resume',async({page},info)=>{
  await page.goto('/');await page.locator('input[name="game-mode"][value="normal"]').check();await page.locator('#start').click();
  await page.waitForFunction(()=>(window as any).flightSnapshot?.().phase==='playing');
  await page.keyboard.down('Space');
  await page.waitForFunction(()=>(window as any).flightSnapshot().player.reloadTicksRemaining>300,null,{timeout:30000});
  await page.keyboard.up('Space');await expect(page.locator('#reload-status')).toBeVisible();
  const loaded=await snapshot(page);expect(loaded.player.mg).toBe(0);expect(loaded.player.cannon).toBe(0);
  await page.screenshot({path:info.outputPath('reload.png')});
  await page.locator('#pause').click();const paused=await snapshot(page);
  await page.locator('#pause-controls').click();await page.locator('#control-cancel').click();
  expect((await snapshot(page)).player.reloadTicksRemaining).toBe(paused.player.reloadTicksRemaining);
  await page.locator('#resume').click();
  await page.waitForFunction(()=>(window as any).flightSnapshot().player.reloadTicksRemaining===0);
  const complete=await snapshot(page);expect(complete.player.mg).toBe(288);expect(complete.player.cannon).toBe(96);
  await expect(page.locator('#reload-status')).toBeHidden();
});

test('manually aimed Easy destruction pauses, expires and clears on replay',async({page},info)=>{
 await page.goto('/');await page.locator('input[name="game-mode"][value="easy"]').check();await page.locator('#start').click();
 await page.waitForFunction(()=>(window as any).flightSnapshot?.().elapsed>.1);
 await aimUsingPointerUntilKill(page);
 await page.locator('#pause').click();const paused=await snapshot(page);
 expect(paused.render.wreckModels).toBe(paused.wrecks.length);expect(paused.render.persistentDamageSmoke).toBe(0);
 const id=paused.wrecks[0].id,age=paused.wrecks[0].age;
 await page.screenshot({path:info.outputPath('wreck-paused-overlay-hidden.png'),style:'#pause-screen { visibility: hidden !important; }'});
 await page.locator('#pause-controls').click();await page.locator('#control-cancel').click();
 expect((await snapshot(page)).wrecks.find((w:any)=>w.id===id).age).toBe(age);
 await page.locator('#resume').click();
 await page.waitForFunction(id=>!(window as any).flightSnapshot().wrecks.some((w:any)=>w.id===id),id);
 await page.screenshot({path:info.outputPath('wreck-expired.png')});
 await page.locator('#pause').click();await page.locator('#quit').click();await expect(page.locator('#home')).toBeVisible();
 await page.locator('input[name="game-mode"][value="normal"]').check();await page.locator('#start').click();
 await page.waitForFunction(()=>(window as any).flightSnapshot().elapsed>.2);const replay=await snapshot(page);
 expect(replay.kills).toBe(0);expect(replay.render.wreckModels).toBe(0);expect(replay.render.aircraftParticles).toBe(0);
 expect(replay.render.tracerSegments).toBe(0);
});

test.describe('dense mobile tracer rendering',()=>{
 test.use({deviceScaleFactor:3});
 test('readable real bullets retain CSS width across portrait/landscape and clear on replay',async({page},info)=>{
  await page.goto('/');await page.locator('input[name="game-mode"][value="normal"]').check();await page.locator('#start').click();
  await page.keyboard.down('Space');
  await page.waitForFunction(()=>{const s=(window as any).flightSnapshot?.();return s?.elapsed>.4&&s.render.tracerSegments>0;});
  await page.keyboard.up('Space');await page.locator('#pause').click();
  const paused=await snapshot(page);expect(paused.render.tracerCoreWidth).toBe(1.5);expect(paused.render.tracerOutlineWidth).toBe(2.5);
  expect(await page.evaluate(()=>devicePixelRatio)).toBe(3);
  for(const size of [{width:393,height:852},{width:852,height:393}]){
   await page.setViewportSize(size);
   await expect(page.locator('#reticle')).toHaveCSS('border-top-width','1px');
   await page.screenshot({path:info.outputPath(`tracers-dpr3-${size.width}-paused-overlay-hidden.png`),style:'#pause-screen { visibility:hidden !important; }'});
   const s=await snapshot(page);expect(s.elapsed).toBe(paused.elapsed);expect(s.render.tracerSegments).toBe(paused.render.tracerSegments);
  }
  await page.locator('#quit').click();await page.locator('#start').click();
  await page.waitForFunction(()=>(window as any).flightSnapshot().elapsed>.2);
  expect((await snapshot(page)).render.tracerSegments).toBe(0);
 });
});
