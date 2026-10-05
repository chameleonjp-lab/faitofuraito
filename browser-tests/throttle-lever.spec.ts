import { test, expect, type Page } from '@playwright/test';
const REPO = 'faitofuraito';
const legacyKey = `${REPO}-controls-v1`, currentKey = `${REPO}-controls-v2`;
const legacy = JSON.stringify({version:1,controls:{fire:{x:.83,y:.84,size:96,opacity:.9},loop:{x:.83,y:.66,size:72,opacity:.78},accelerate:{x:.16,y:.8,size:68,opacity:.75},brake:{x:.16,y:.58,size:68,opacity:.75}}});
test.beforeEach(async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:200,contentType:'application/json',body:'[]'}));
});
async function range(page:Page,selector:string,value:string){await page.locator(selector).evaluate((element,value)=>{(element as HTMLInputElement).value=value;element.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function settings(page:Page){await page.locator('#home-controls').click();await page.locator('#control-editor-touch').click();await page.locator('#control-mode').selectOption('normal');}
for(const viewport of [{width:320,height:568},{width:393,height:852},{width:568,height:320},{width:852,height:393}]){
 test(`v1 read migration, repeated v2 save, rectangular preview and 200% settings ${viewport.width}x${viewport.height}`,async({page},info)=>{
  await page.setViewportSize(viewport);
  await page.addInitScript(({legacyKey,legacy})=>{if(!localStorage.getItem(legacyKey))localStorage.setItem(legacyKey,legacy);},{legacyKey,legacy});
  await page.goto('/');await settings(page);
  await expect(page.locator('#control-target option:enabled')).toHaveCount(3);await page.locator('#control-target').selectOption('throttle');
  await expect(page.locator('#control-target')).toHaveValue('throttle');await expect(page.locator('.preview-control[data-control="throttle"]')).toBeVisible();
  const rectangles=await page.locator('#control-preview').evaluate(preview=>{
   const outer=preview.getBoundingClientRect();return [...preview.querySelectorAll<HTMLElement>('.preview-control:not([hidden])')].map(el=>{const r=el.getBoundingClientRect();return {name:el.dataset.control,x:r.x-outer.x,y:r.y-outer.y,w:r.width,h:r.height,pw:outer.width,ph:outer.height};});
  });
  for(const r of rectangles){expect(r.x).toBeGreaterThanOrEqual(-1);expect(r.y).toBeGreaterThanOrEqual(-1);expect(r.x+r.w).toBeLessThanOrEqual(r.pw+1);expect(r.y+r.h).toBeLessThanOrEqual(r.ph+1);if(r.name==='throttle')expect(r.h).toBeGreaterThan(r.w*1.8);}
  await page.screenshot({path:info.outputPath(`lever-settings-${viewport.width}x${viewport.height}.png`)});
  expect(await page.evaluate(key=>localStorage.getItem(key),currentKey)).toBeNull();
  await range(page,'#control-x','25');await page.locator('#control-cancel').click();
  expect(await page.evaluate(key=>localStorage.getItem(key),currentKey)).toBeNull();
  for(const opacity of ['70','80']){await settings(page);await page.locator('#control-target').selectOption('throttle');await range(page,'#control-opacity',opacity);await page.locator('#control-save').click();await expect(page.locator('#control-settings')).toBeHidden();}
  expect(await page.evaluate(key=>localStorage.getItem(key),legacyKey)).toBe(legacy);
  expect(JSON.parse((await page.evaluate(key=>localStorage.getItem(key),currentKey))!).version).toBe(2);
  await page.reload();await settings(page);await page.locator('#control-target').selectOption('throttle');await expect(page.locator('#control-opacity')).toHaveValue('80');
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
  await page.locator('#control-save').scrollIntoViewIfNeeded();await expect(page.locator('#control-save')).toBeInViewport();await page.screenshot({path:info.outputPath(`lever-settings-large-text-${viewport.width}x${viewport.height}.png`)});
  await page.locator('#control-cancel').click();await expect(page.locator('#control-settings')).toBeHidden();
 });
}
test('future v2, legacy raw and failed save remain protected through cancel and session-only use',async({page})=>{
 await page.addInitScript(({legacyKey,legacy,currentKey})=>{localStorage.setItem(legacyKey,legacy);localStorage.setItem(currentKey,JSON.stringify({version:9,unknown:'preserve'}));},{legacyKey,legacy,currentKey});
 await page.goto('/');await settings(page);await page.locator('#control-target').selectOption('throttle');await range(page,'#control-opacity','65');await page.locator('#control-save').click();
 await expect(page.locator('#control-save')).toHaveText('今回だけ使う');await page.locator('#control-cancel').click();
 expect(await page.evaluate(key=>localStorage.getItem(key),legacyKey)).toBe(legacy);expect(JSON.parse((await page.evaluate(key=>localStorage.getItem(key),currentKey))!).version).toBe(9);
 await settings(page);await page.locator('#control-target').selectOption('throttle');await range(page,'#control-opacity','65');await page.locator('#control-save').click();await page.locator('#control-save').click();await expect(page.locator('#control-settings')).toBeHidden();
 expect(JSON.parse((await page.evaluate(key=>localStorage.getItem(key),currentKey))!).version).toBe(9);
});
test('real browser pointer and focused slider input spring home and release independently',async({page},info)=>{
 // DOM integration harness deliberately excludes WebGL so WebKit exercises the same production input class.
 await page.route('**/throttle-harness',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>'}));
 await page.goto('/throttle-harness');
 await page.evaluate(async()=>{
  const {FlightControls}=await import('/src/input.ts');
  document.body.innerHTML='<div id="app"><div id="surface" tabindex="0" style="position:absolute;left:120px;top:10px;width:160px;height:240px"></div><button id="fire">射撃</button><button id="loop">宙返り</button><div id="throttle" role="slider" tabindex="0" style="position:absolute;left:20px;top:100px;width:64px;height:160px"></div></div>';
  const controls=new FlightControls(document.querySelector('#surface')!,{fire:document.querySelector('#fire')!,loop:document.querySelector('#loop')!,throttle:document.querySelector('#throttle')!},()=>true);
  (window as any).leverControls=controls;
 });
 const read=()=>page.evaluate(()=>(window as any).leverControls.sample());
 await page.mouse.move(52,122);await page.mouse.down();expect((await read()).throttle).toBe(1);
 await page.mouse.move(52,500);expect((await read()).throttle).toBe(-1);
 await page.mouse.up();expect((await read()).throttle).toBe(0);
 await page.locator('#throttle').focus();await page.keyboard.down('ArrowUp');expect((await read()).throttle).toBe(1);expect((await read()).climb).toBe(0);
 await page.keyboard.up('ArrowUp');expect((await read()).throttle).toBe(0);
 await page.keyboard.press('ArrowDown');expect((await read()).throttle).toBe(-1);expect((await read()).throttle).toBe(0);
 await page.keyboard.down('ArrowUp');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));expect((await read()).throttle).toBe(0);await page.keyboard.up('ArrowUp');
 await page.locator('#throttle').focus();await page.keyboard.down('End');expect((await read()).throttle).toBe(1);await page.setViewportSize({width:852,height:393});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));expect((await read()).throttle).toBe(0);await page.keyboard.up('End');
 await page.locator('#throttle').focus();await page.keyboard.press('Home');await page.evaluate(()=>(window as any).leverControls.setMode('easy'));expect((await read()).throttle).toBe(0);
 await page.screenshot({path:info.outputPath('lever-dom-integration.png')});
});
test('Normal live flight accepts the lever, stops through settings and Easy has none',async({page,browserName},info)=>{
 test.skip(browserName==='webkit','Linux WebKit project verifies production input DOM and settings; software WebGL is unavailable');
 await page.goto('/');await page.locator('input[value="normal"]').check();await page.locator('#start').click();await expect(page.locator('#throttle')).toBeVisible();await expect(page.locator('#accelerate')).toHaveCount(0);await expect(page.locator('#brake')).toHaveCount(0);
 const box=(await page.locator('#throttle').boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThan(box.width);
 const beforeSpeed=Number.parseFloat((await page.locator('#speed').textContent())!);
 await page.mouse.move(box.x+box.width/2,box.y+22);await page.mouse.down();await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow','100');
 await expect.poll(async()=>Number.parseFloat((await page.locator('#speed').textContent())!)).toBeGreaterThan(beforeSpeed+1);await page.mouse.up();await expect(page.locator('#throttle')).toHaveAttribute('aria-valuenow','0');
 await page.screenshot({path:info.outputPath('lever-flight-portrait.png')});
 await page.keyboard.press('Escape');await page.locator('#pause-controls').click();await page.locator('#control-editor-touch').click();await page.locator('#control-target').selectOption('throttle');await page.locator('#control-cancel').click();await expect(page.locator('#resume')).toBeVisible();await page.locator('#resume').click();
 await page.setViewportSize({width:852,height:393});await page.screenshot({path:info.outputPath('lever-flight-landscape.png')});
 await page.keyboard.press('Escape');await page.locator(REPO==='faitofuraito'?'#quit':'#pause-home').click();await page.locator('input[value="easy"]').check();await page.locator('#start').click();await expect(page.locator('#throttle')).toBeHidden();
});

for(const viewport of [{width:320,height:568},{width:568,height:320}])for(const fontSize of ['100%','200%']){
 test(`hidden HUD obstacle measurement preserves controls ${viewport.width}x${viewport.height} text ${fontSize}`,async({page,browserName})=>{
  await page.setViewportSize(viewport);await page.goto('/');
  await page.evaluate(value=>{document.documentElement.style.fontSize=value;},fontSize);
  const measured=await page.evaluate(async()=>{
   const {measureHudObstacles}=await import('/src/control-obstacles.ts');
   const app=document.querySelector<HTMLElement>('#app')!;const before=app.outerHTML;const obstacles=measureHudObstacles(app);
   return {obstacles,unchanged:before===app.outerHTML,apps:document.querySelectorAll('#app').length,huds:document.querySelectorAll('#hud').length,width:app.clientWidth,height:app.clientHeight};
  });
  expect(measured.unchanged).toBe(true);expect(measured.apps).toBe(1);expect(measured.huds).toBe(1);expect(measured.obstacles.length).toBeGreaterThan(0);
  for(const obstacle of measured.obstacles){
   const old=JSON.stringify({version:1,controls:{fire:{x:.83,y:.84,size:96,opacity:.9},loop:{x:.83,y:.66,size:72,opacity:.78},accelerate:{x:obstacle.x/measured.width,y:obstacle.y/measured.height,size:64,opacity:.82},brake:{x:obstacle.x/measured.width,y:obstacle.y/measured.height,size:64,opacity:.82}}});
   await page.evaluate(({legacyKey,old,currentKey})=>{localStorage.setItem(legacyKey,old);localStorage.removeItem(currentKey);},{legacyKey,old,currentKey});await page.reload();await page.evaluate(value=>{document.documentElement.style.fontSize=value;},fontSize);
   await settings(page);await page.locator('#control-target').selectOption('throttle');await page.locator('#control-preview').scrollIntoViewIfNeeded();await expect(page.locator('.preview-throttle')).not.toHaveAttribute('aria-disabled','true');await page.locator('#control-cancel').click();
   expect(await page.evaluate(key=>localStorage.getItem(key),legacyKey)).toBe(old);
   if(browserName==='chromium'){
    await page.locator('input[value="normal"]').check();await page.locator('#start').click();await expect(page.locator('#throttle')).toBeVisible();
    const reachability=await page.locator('#hud').evaluate(hud=>{
     const rect=(element:Element)=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
     const buttons=[...hud.querySelectorAll<HTMLElement>('button:not(.action-control):not(.flight-button):not([data-flight-control])')].map(button=>{
      const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return {id:button.id,rect:rect(button),hit:hit?{id:hit.id,tag:hit.tagName,classes:hit.className}:null,reachable:hit===button||Boolean(hit&&button.contains(hit))};
     });
     return {buttons,lever:rect(document.getElementById('throttle')!),app:rect(document.getElementById('app')!),viewport:[innerWidth,innerHeight],controls:[...hud.querySelectorAll('.action-control')].map(element=>({id:element.id,rect:rect(element)}))};
    });
    console.log('THROTTLE_HUD_GEOMETRY '+JSON.stringify({viewport,fontSize,obstacle,measured,reachability}));
    expect(reachability.buttons.filter(button=>!button.reachable),JSON.stringify(reachability)).toEqual([]);
    const lever=(await page.locator('#throttle').boundingBox())!;expect(lever.height/lever.width).toBeGreaterThan(1.8);expect(lever.width).toBeGreaterThanOrEqual(44);
    await page.locator('#pause').click();await page.locator(REPO==='faitofuraito'?'#quit':'#pause-home').click();
   }
  }
 });
}

test('settings footer and close remain reachable at 200 percent CSS zoom',async({page},info)=>{
 await page.goto('/');await page.locator('#home-controls').click();await page.locator('#control-editor-touch').click();await page.locator('#control-mode').selectOption('normal');
 await page.addStyleTag({content:'html { zoom: 2; }'});
 await page.locator('#control-opacity').scrollIntoViewIfNeeded();await expect(page.locator('#control-opacity')).toBeInViewport();
 await page.locator('#control-save').scrollIntoViewIfNeeded();await expect(page.locator('#control-save')).toBeInViewport({ratio:1});
 const dialog=await page.locator('#control-settings').boundingBox(),viewport=page.viewportSize()!;expect(dialog!.x).toBeGreaterThanOrEqual(0);expect(dialog!.x+dialog!.width).toBeLessThanOrEqual(viewport.width);
 await page.screenshot({path:info.outputPath('lever-settings-css-zoom-200.png')});
 await page.locator('#control-cancel').click();await expect(page.locator('#control-settings')).toBeHidden();
});
