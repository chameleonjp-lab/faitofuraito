import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:200,contentType:'application/json',body:'[]'}));
});
for(const size of [{width:393,height:648},{width:568,height:320}]) test(`mobile settings and rules ${size.width}x${size.height}`,async({page},info)=>{
 await page.setViewportSize(size);
 await page.addInitScript(()=>{
  (window as any).__guidePointerEvents=[];
  for(const name of ['pointerdown','pointerup','click'])window.addEventListener(name,event=>{
   if(event.target instanceof Element && event.target.closest('#home-rules'))(window as any).__guidePointerEvents.push({type:event.type,pointerType:(event as PointerEvent).pointerType});
  },{capture:true});
 });
 await page.goto('/');await expect(page.locator('#start')).toBeEnabled();
 await page.locator('#home-controls').tap();await page.locator('#control-editor-touch').tap();
 const select=page.locator('#control-target');await expect(select).toBeVisible();
 const color=await select.evaluate(e=>({color:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}));expect(color.color).not.toBe(color.bg);
 await expect(page.locator('#control-mode')).toHaveValue('easy');
 await page.locator('#control-mode').selectOption('normal');await select.selectOption('fire');
 await page.locator('#control-size').scrollIntoViewIfNeeded();await page.locator('#control-size').press('End');
 const changed=await page.locator('#control-size').inputValue();await page.screenshot({path:info.outputPath('touch-settings-scrolled.png')});
 await page.locator('#control-preview').scrollIntoViewIfNeeded();
 const preview=await page.locator('#control-preview').boundingBox(),region=await page.locator('.settings-main').boundingBox();
 expect(preview!.height).toBeLessThanOrEqual(region!.height);
 for(const action of ['fire','loop','accelerate','brake'])await expect(page.locator(`.preview-control[data-control="${action}"]`)).toBeInViewport();
 const fits=await page.locator('.preview-control:not([hidden]) > span').evaluateAll(nodes=>nodes.every(node=>{
  const r=node.getBoundingClientRect(),p=node.closest('#control-preview')!.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom;
 }));expect(fits).toBe(true);await page.screenshot({path:info.outputPath('whole-preview.png')});
 await page.locator('#control-save').click();await page.locator('#home-controls').tap();await page.locator('#control-editor-touch').tap();
 await page.locator('#control-mode').selectOption('normal');await select.selectOption('fire');
 await expect(page.locator('#control-size')).toHaveValue(changed);
 await page.locator('#control-cancel').tap();await page.locator('#home-rules').tap();
 await expect(page.locator('#rules-content')).toContainText('300秒');await expect(page.locator('#rules-content')).toContainText('スマートフォン');
 await info.attach('guide-pointer-events',{body:JSON.stringify(await page.evaluate(()=>(window as any).__guidePointerEvents)),contentType:'application/json'});
 const content=page.locator('#rules-content');await content.evaluate(e=>e.scrollTop=e.scrollHeight);
 await expect(page.locator('#rules-back')).toBeInViewport();await page.screenshot({path:info.outputPath('rules-bottom.png')});
 await page.locator('#rules-back').tap();await expect(page.locator('#home-rules')).toBeFocused();
 expect(await page.evaluate(()=>(window as any).flightSnapshot().phase)).toBe('ready');
});
