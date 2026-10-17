import { test, expect } from '@playwright/test';
import { Euler, Quaternion, Vector3 } from 'three';
import { FLIGHT_FOV, getFlightCameraPose } from '../src/flight-view';
const cameraTest = test.extend({
  screenshot: 'off',
  trace: 'off',
});
const snapshot = (page: any) => page.evaluate(() => (window as any).flightSnapshot());
const cameraProbe = (page: any) => page.evaluate(() => (window as any).__flightCameraProbe);

async function installActualCameraProbe(page: any) {
  await page.evaluate(async () => {
    // Vite resolves this URL to the same module instance imported by main.ts.
    const sceneModuleUrl = '/src/scene.ts';
    const { FlightScene } = await import(sceneModuleUrl);
    const prototype: any = FlightScene.prototype;
    if (prototype.__flightCameraProbeInstalled) throw new Error('camera probe was installed twice');
    const originalRender = prototype.render;
    prototype.__flightCameraProbeOriginalRender = originalRender;
    (window as any).__flightCameraProbe = { calls: 0, samples: [] as any[] };
    const observedRender = function (this: any, state: any, dt: number) {
      const result = originalRender.call(this, state, dt);
      const probe = (window as any).__flightCameraProbe;
      probe.calls += 1;
      // Sample one in every three real renders, capped at 96; capture camera and
      // player state from this same render immediately after the original render.
      if (state.phase === 'playing' && probe.calls % 3 === 0) {
        probe.samples.push({
          phase: state.phase, mode: state.mode, elapsed: state.elapsed, dt,
          camera: {
            position: this.camera.position.toArray(),
            quaternion: this.camera.quaternion.toArray(),
            aspect: this.camera.aspect, fov: this.camera.fov,
          },
          player: {
            position: state.player.position.toArray(), quaternion: state.player.quaternion.toArray(),
            pitch: state.player.pitch, yaw: state.player.yaw, bank: state.player.bank, speed: state.player.speed,
          },
          renderedPlayerQuaternion: this.playerVisual.root.quaternion.toArray(),
        });
        if (probe.samples.length > 96) probe.samples.shift();
      }
      return result;
    };
    prototype.__flightCameraProbeInstalled = true;
    prototype.render = observedRender;
  });
}

async function restoreActualCameraProbe(page: any) {
  await page.evaluate(async () => {
    const sceneModuleUrl = '/src/scene.ts';
    const { FlightScene } = await import(sceneModuleUrl);
    const prototype: any = FlightScene.prototype;
    if (prototype.__flightCameraProbeInstalled) {
      prototype.render = prototype.__flightCameraProbeOriginalRender;
      delete prototype.__flightCameraProbeOriginalRender;
      delete prototype.__flightCameraProbeInstalled;
    }
    delete (window as any).__flightCameraProbe;
  });
}

async function latestCameraSample(page: any) {
  const probe = await cameraProbe(page);
  expect(probe?.calls).toBeGreaterThan(0);
  expect(probe?.samples.length).toBeGreaterThan(0);
  return probe.samples[probe.samples.length - 1];
}

function expectRenderedPoseMatchesFlightView(sample: any) {
  expect(sample.phase).toBe('playing');
  const player: any = {
    position: new Vector3().fromArray(sample.player.position),
    quaternion: new Quaternion().fromArray(sample.player.quaternion),
    bank: sample.player.bank,
  };
  const expectedPosition = new Vector3(), expectedQuaternion = new Quaternion();
  getFlightCameraPose(player, sample.mode, expectedPosition, expectedQuaternion);
  const actualPosition = new Vector3().fromArray(sample.camera.position);
  const actualQuaternion = new Quaternion().fromArray(sample.camera.quaternion);
  const renderedPlayerQuaternion = new Quaternion().fromArray(sample.renderedPlayerQuaternion);
  expect(expectedPosition.distanceTo(actualPosition)).toBeLessThan(1e-9);
  expectEquivalentQuaternions(expectedQuaternion, actualQuaternion);
  expectEquivalentQuaternions(player.quaternion, renderedPlayerQuaternion);
  expect(sample.camera.fov).toBe(FLIGHT_FOV);
}

function expectEquivalentQuaternions(expected: Quaternion, actual: Quaternion) {
  const expectedComponents = expected.toArray();
  const actualComponents = actual.toArray();
  const directDifference = Math.max(...expectedComponents.map((component, index) => Math.abs(component - actualComponents[index])));
  const negatedDifference = Math.max(...expectedComponents.map((component, index) => Math.abs(component + actualComponents[index])));
  // q and -q encode the same rotation. Component comparison avoids angleTo's
  // acos rounding floor while retaining a strict numerical check.
  expect(Math.min(directDifference, negatedDifference)).toBeLessThan(1e-12);
}

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
    await page.waitForFunction((t: number)=>(window as any).flightSnapshot().elapsed>=t+.1|| (window as any).flightSnapshot().phase!=='playing',s.elapsed);
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

const cameraViewports = [
  { width: 393, height: 852 },
  { width: 393, height: 648 },
  { width: 568, height: 320 },
  { width: 852, height: 393 },
  { width: 1280, height: 720 },
];

for (const mode of ['easy', 'normal'] as const) cameraTest(`${mode}: rendered camera follows live flight across viewport rotation and input release`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-17T00:00:00Z') });
  await page.goto('/');
  await page.locator('#start').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !(document.querySelector('#start') as HTMLButtonElement).disabled);
  try {
    await installActualCameraProbe(page);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.locator(`input[name="game-mode"][value="${mode}"]`).check();
    await page.locator('#start').click();
    await page.clock.runFor(250);
    expect((await snapshot(page)).phase).toBe('playing');
    expect((await snapshot(page)).elapsed).toBeGreaterThan(0.1);
    await page.waitForFunction(() => (window as any).__flightCameraProbe?.samples.length > 0);

    // Real pointer drag, then release: the rendered aircraft and optical axis both move.
    const canvas = page.locator('#flight');
    const pointerStart = await latestCameraSample(page);
    const initialBox = await canvas.boundingBox();
    expect(initialBox).not.toBeNull();
    const origin = { x: initialBox!.x + initialBox!.width * 0.32, y: initialBox!.y + initialBox!.height * 0.5 };
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 31, origin.y - 19, { steps: 3 });
    await expect(page.locator('#joystick')).toHaveClass(/visible/);
    await page.clock.runFor(250);
    const pointerMoved = await latestCameraSample(page);
    expect(Math.abs(pointerMoved.player.pitch - pointerStart.player.pitch)
      + Math.abs(pointerMoved.player.yaw - pointerStart.player.yaw)).toBeGreaterThan(0.001);
    expectRenderedPoseMatchesFlightView(pointerMoved);
    await page.mouse.up();
    await expect(page.locator('#joystick')).not.toHaveClass(/visible/);
    await page.clock.runFor(200);

    // Normal keyboard input raises pitch; horizontal steering alone holds it,
    // and releasing that key allows the bounded neutral return to level.
    if (mode === 'normal') {
      const beforeKeys = await latestCameraSample(page);
      await page.keyboard.down('ArrowUp');
      await page.keyboard.down('ArrowRight');
      await page.clock.runFor(250);
      const climbed = await latestCameraSample(page);
      expect(climbed.player.pitch).toBeGreaterThan(beforeKeys.player.pitch + 0.02);
      expectRenderedPoseMatchesFlightView(climbed);

      await page.keyboard.up('ArrowUp');
      await page.clock.runFor(100);
      const horizontalStart = await latestCameraSample(page);
      await page.clock.runFor(250);
      const horizontalEnd = await latestCameraSample(page);
      expect(Math.abs(horizontalEnd.player.pitch - horizontalStart.player.pitch)).toBeLessThan(1e-9);
      expectRenderedPoseMatchesFlightView(horizontalEnd);

      await page.keyboard.up('ArrowRight');
      await page.clock.runFor(250);
      const released = await latestCameraSample(page);
      expect(released.player.pitch).toBeLessThan(horizontalEnd.player.pitch - 0.01);
      expectRenderedPoseMatchesFlightView(released);
    }

    // Actual portrait, short-portrait, landscape and desktop viewports. The
    // 200% case scales the document root font size only; it is not native
    // text-only browser zoom. Orientation changes happen during active flight.
    for (const size of cameraViewports) {
      await page.setViewportSize(size);
      const rootFont200 = size.width === 393 && size.height === 648;
      if (rootFont200) await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      else if (await page.evaluate(() => document.documentElement.style.fontSize === '200%')) {
        await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });
      }
      await page.clock.runFor(150);
      if (rootFont200) expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      const sample = await latestCameraSample(page);
      expect(sample.mode).toBe(mode);
      expect(sample.elapsed).toBeGreaterThan(0);
      expect(sample.camera.aspect).toBeCloseTo(box!.width / box!.height, 6);
      expectRenderedPoseMatchesFlightView(sample);
    }

    // Pause freezes gameplay time; quitting and starting again creates a fresh flight.
    await page.locator('#pause').click();
    const paused = await snapshot(page);
    expect(paused.phase).toBe('paused');
    await page.clock.runFor(200);
    expect((await snapshot(page)).elapsed).toBe(paused.elapsed);
    await page.locator('#quit').click();
    await expect(page.locator('#home')).toBeVisible();
    const reset = await snapshot(page);
    expect(reset.elapsed).toBe(0);
    expect(reset.kills).toBe(0);
    await page.locator('#start').click();
    await page.clock.runFor(250);
    const replay = await snapshot(page);
    expect(replay.phase).toBe('playing');
    expect(replay.mode).toBe(mode);
    expect(replay.elapsed).toBeGreaterThan(0.1);
    const replaySample = await latestCameraSample(page);
    expect(replaySample.mode).toBe(mode);
    expectRenderedPoseMatchesFlightView(replaySample);

    // Switch modes in the same page/context to verify the new flight state and
    // its same-render camera sample are both reset through the real UI path.
    await page.locator('#pause').click();
    expect((await snapshot(page)).phase).toBe('paused');
    await page.locator('#quit').click();
    await expect(page.locator('#home')).toBeVisible();
    const oppositeMode = mode === 'easy' ? 'normal' : 'easy';
    await page.locator(`input[name="game-mode"][value="${oppositeMode}"]`).check();
    await page.locator('#start').click();
    await page.clock.runFor(250);
    const switched = await snapshot(page);
    expect(switched.phase).toBe('playing');
    expect(switched.mode).toBe(oppositeMode);
    expect(switched.elapsed).toBeGreaterThan(0.1);
    expect(switched.elapsed).toBeLessThan(0.4);
    await page.waitForFunction((expectedMode: string) => {
      const samples = (window as any).__flightCameraProbe?.samples;
      return samples?.some((sample: any) => sample.mode === expectedMode && sample.elapsed > 0);
    }, oppositeMode);
    const switchedSample = await latestCameraSample(page);
    expect(switchedSample.mode).toBe(oppositeMode);
    expect(switchedSample.elapsed).toBeGreaterThan(0);
    expectRenderedPoseMatchesFlightView(switchedSample);
    expect(errors).toEqual([]);
  } finally {
    try {
      const probe = await cameraProbe(page);
      if (probe !== undefined) {
        console.log(JSON.stringify({ mode, viewports: cameraViewports, probe }));
      }
    } finally {
      await restoreActualCameraProbe(page);
    }
  }
});
