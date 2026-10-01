/*
 * Focused visual-effect render fixture. The fixture is served as a separate
 * test-only page and imports the real FlightScene/simulation modules; the
 * ordinary game page is used only for a normal start-screen-to-flight capture.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { createHash } = require('node:crypto');

const projectRoot = path.resolve(__dirname, '..');
const evidenceDir = path.resolve(projectRoot, process.env.EVIDENCE_DIR || 'evidence');
const port = Number(process.env.VFX_PORT || 5173);
const gameUrl = 'http://127.0.0.1:' + port + '/';
let browser;
let server;

const fixtureHtml = '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">' +
  '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#4e7fa1}canvas{display:block;width:100vw;height:100vh}</style>' +
  '</head><body><canvas id="flight"></canvas><script type="module">' +
  'import { FlightScene } from "/src/scene.ts";' +
  'import { createGame, startGame, stepGame, pauseGame, resumeGame, DURATION } from "/src/simulation.ts";' +
  'const canvas=document.querySelector("#flight");' +
  'const scene=new FlightScene(canvas);' +
  'scene.resize(innerWidth,innerHeight);' +
  'const neutral={turn:0,climb:0,fire:false,loop:false};' +
  'let state=createGame(0x564658);' +
  'startGame(state);' +
  'function setScenario(nextState){' +
  ' state=nextState;' +
  ' const p=state.player;' +
  ' p.position.set(0,2400,0);p.previous.copy(p.position);p.yaw=0;p.pitch=0;p.bank=0;p.quaternion.set(0,0,0,1);p.speed=110;p.health=100;' +
  ' const e=state.enemies[0];' +
  ' e.position.set(0,2400,-45);e.previous.copy(e.position);e.yaw=0;e.pitch=0;e.bank=0;e.quaternion.set(0,0,0,1);e.speed=110;e.health=30;e.mode="flee";e.mg=0;e.cannon=0;' +
  ' state.wrecks.length=0;state.bullets.length=0;state.elapsed=0;state.phase="playing";' +
  '}' +
  'function pinEnemy(distance,side=0){const p=state.player,e=state.enemies[0];if(!e)return;e.position.set(p.position.x+side,p.position.y,p.position.z-distance);e.previous.copy(e.position);e.yaw=p.yaw;e.pitch=p.pitch;e.bank=p.bank;e.quaternion.copy(p.quaternion);e.speed=p.speed;e.mode="flee";e.mg=0;e.cannon=0;}' +
  'setScenario(state);scene.render(state,0);' +
  'function metrics(){' +
  ' const smoke=scene.plumeParticles.filter(p=>p.active);const fire=scene.flameParticles.filter(p=>p.active);' +
  ' const opacity=scene.plumeSmoke.geometry.getAttribute("particleOpacity");const values=Array.from({length:scene.plumeSmoke.count},(_,i)=>opacity.getX(i));' +
  ' return {phase:state.phase,elapsed:Number(state.elapsed.toFixed(2)),enemyHealth:state.enemies[0]?state.enemies[0].health:null,enemyCount:state.enemies.length,wreckCount:state.wrecks.length,wreckAge:state.wrecks[0]?Number(state.wrecks[0].age.toFixed(2)):null,bulletCount:state.bullets.length,shots:state.shots,smokeInstances:scene.plumeSmoke.count,smokeOpacity:values.length?{min:Math.min(...values),max:Math.max(...values)}:null,oldestSmoke:Math.max(0,...smoke.map(p=>p.age)),flameInstances:scene.wreckFlames.count,activeSmoke:smoke.length,activeFlames:fire.length,smokeAgeSum:Number(smoke.reduce((n,p)=>n+p.age,0).toFixed(4)),flameAgeSum:Number(fire.reduce((n,p)=>n+p.age,0).toFixed(4)),wreckVisuals:scene.wreckVisuals.size,render:scene.stats()};' +
  '}' +
  'function advance(seconds,renderInterval=0.1,pinTarget=false){' +
  ' let left=seconds,elapsedSinceRender=0;const tick=1/60;' +
  ' while(left>1e-8){const dt=Math.min(tick,left);stepGame(state,neutral,dt);if(pinTarget)pinEnemy(65);left-=dt;elapsedSinceRender+=dt;if(elapsedSinceRender>=renderInterval-1e-6){scene.render(state,elapsedSinceRender);elapsedSinceRender=0;}}' +
  ' if(elapsedSinceRender>1e-6)scene.render(state,elapsedSinceRender);return metrics();' +
  '}' +
  'window.vfxFixture={' +
  ' metrics,' +
  ' trace(){' +
  '  state.player.cannon=0;pinEnemy(180,36);' +
  '  for(let i=0;i<13;i++){stepGame(state,{turn:0,climb:0,fire:true,loop:false},1/60);pinEnemy(180,36);}' +
  '  scene.render(state,1/60);return metrics();' +
  ' },' +
  ' clearBullets(){state.bullets.length=0;state.events.length=0;return metrics();},' +
  ' advance,' +
  ' pause(){pauseGame(state);for(let i=0;i<6;i++)scene.render(state,0.1);return metrics();},' +
  ' resume(){resumeGame(state);return metrics();},' +
  ' slowSmoke(){return advance(3.6,0.9,true);},' +
  ' killAndEnd(){' +
  '  state.bullets.length=0;state.elapsed=DURATION-1;const e=state.enemies[0];e.health=30;pinEnemy(32);let killed=false;' +
  '  for(let i=0;i<24&&!killed;i++){pinEnemy(32);stepGame(state,{turn:0,climb:0,fire:true,loop:false},1/60);scene.render(state,1/60);killed=state.wrecks.length>0;}' +
  '  if(!killed)throw new Error("The focused salvo did not create a wreck; state="+JSON.stringify({enemy:state.enemies[0]&&{health:state.enemies[0].health,position:state.enemies[0].position.toArray(),quaternion:state.enemies[0].quaternion.toArray()},player:state.player.position.toArray(),bullets:state.bullets.map(b=>({position:b.position.toArray(),velocity:b.velocity.toArray()})),shots:state.shots}));' +
  '  for(let i=0;i<24&&state.phase==="playing";i++){stepGame(state,neutral,1/60);scene.render(state,1/60);}' +
  '  state.mode="easy";state.elapsed=DURATION-0.05;stepGame(state,neutral,0.1);scene.render(state,0.1);' +
  '  if(state.phase!=="ended")throw new Error("Fixture did not reach ended state");return metrics();' +
  ' },' +
  ' reset(){state=createGame(0x564659);scene.render(state,0);return metrics();},' +
  ' dispose(){scene.dispose();}' +
  '};' +
  'window.fixtureReady=true;' +
  '</script></body></html>';

async function startServer() {
  server = spawn(process.execPath, [
    path.join(projectRoot, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort',
  ], { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite startup timed out. ' + log)), 15000);
    server.stdout.on('data', data => {
      log += data.toString();
      if (log.includes('Local:')) { clearTimeout(timeout); resolve(); }
    });
    server.stderr.on('data', data => { log += data.toString(); });
    server.on('exit', code => { clearTimeout(timeout); reject(new Error('Vite exited (' + code + '). ' + log)); });
  });
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  await startServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const dpr = Number(process.env.BROWSER_DPR || 0.75);
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/__vfx_fixture__', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml }));
  await page.goto(gameUrl + '__vfx_fixture__');
  await page.waitForFunction(() => window.fixtureReady === true);

  const read = () => page.evaluate(() => window.vfxFixture.metrics());
  const capture = async name => {
    await page.screenshot({ path: path.join(evidenceDir, name), animations: 'disabled' });
    return read();
  };
  const results = {};

  results.trace = await page.evaluate(() => window.vfxFixture.trace());
  await page.waitForTimeout(100);
  results.trace = await capture('vfx-tracers.png');
  assert(results.trace.bulletCount >= 6 && results.trace.shots >= 6, 'fixture should contain a real six-round MG burst downrange');

  await page.evaluate(() => window.vfxFixture.clearBullets());
  results.lowHealth = await page.evaluate(() => window.vfxFixture.advance(1.3, 0.05, true));
  results.lowHealth = await capture('vfx-low-health.png');
  assert.equal(results.lowHealth.enemyHealth, 30, 'enemy should remain at the 30% smoke threshold');
  assert(results.lowHealth.smokeInstances > 0, 'low-health smoke should be visible in the scene');
  assert(results.lowHealth.smokeOpacity.min > 0 && results.lowHealth.smokeOpacity.max < 1, 'individual particles fade in alpha');

  const pausedBefore = await read();
  results.paused = await page.evaluate(() => window.vfxFixture.pause());
  await page.waitForTimeout(100);
  results.paused = await capture('vfx-low-health-paused.png');
  assert.equal(results.paused.phase, 'paused');
  assert.equal(results.paused.smokeInstances, pausedBefore.smokeInstances, 'pause must freeze the smoke pool');
  assert.equal(results.paused.smokeAgeSum, pausedBefore.smokeAgeSum, 'pause must freeze particle ages');
  await page.evaluate(() => window.vfxFixture.resume());
  results.slowSmoke = await page.evaluate(() => window.vfxFixture.slowSmoke());
  assert(results.slowSmoke.oldestSmoke <= 1.2, 'smoke age follows gameplay time even with 0.9-second render gaps');

  results.wreckStart = await page.evaluate(() => window.vfxFixture.killAndEnd());
  results.wreckStart = await capture('vfx-wreck-ended-start.png');
  assert.equal(results.wreckStart.phase, 'ended');
  assert(results.wreckStart.wreckCount > 0 && results.wreckStart.wreckVisuals > 0, 'simulated kill should create a visible wreck');
  assert(results.wreckStart.flameInstances > 0 && results.wreckStart.smokeInstances > 0, 'ended wreck should emit fire and smoke');

  results.wreckMid = await page.evaluate(() => window.vfxFixture.advance(1.9));
  results.wreckMid = await capture('vfx-wreck-mid.png');
  assert(results.wreckMid.wreckAge > 2 && results.wreckMid.wreckAge < 3.5, 'wreck age should advance during ended state');
  assert(results.wreckMid.flameInstances > 0 && results.wreckMid.smokeInstances > 0, 'wreck fire and smoke should continue during ended state');

  results.wreckLate = await page.evaluate(() => window.vfxFixture.advance(2.0));
  results.wreckLate = await capture('vfx-wreck-late.png');
  assert(results.wreckLate.wreckAge > 4 && results.wreckLate.wreckAge < 5, 'wreck should remain until its five-second lifetime ends');

  results.expired = await page.evaluate(() => window.vfxFixture.advance(1.0));
  results.expired = await capture('vfx-wreck-expired.png');
  assert.equal(results.expired.wreckCount, 0, 'wreck model should be removed after five seconds');
  assert.equal(results.expired.wreckVisuals, 0, 'wreck visual clones should be released after expiry');
  assert.equal(results.expired.flameInstances, 0, 'burning flames should fade after wreck expiry');
  assert.equal(results.expired.smokeInstances, 0, 'all wreck smoke is removed with its source after five seconds');

  const resourcesBeforeReset = results.wreckStart.render;
  results.reset = await page.evaluate(() => window.vfxFixture.reset());
  assert.equal(results.reset.wreckVisuals, 0, 'new fixture generation should clear wreck roots');
  assert.equal(results.reset.flameInstances, 0, 'new fixture generation should clear flames');
  assert.equal(results.reset.smokeInstances, 0, 'new fixture generation should clear smoke');
  assert.equal(results.reset.render.geometries, resourcesBeforeReset.geometries, 'wreck clones and reset should reuse/dispose cached geometry');
  assert.equal(results.reset.render.textures, resourcesBeforeReset.textures, 'reset should not add textures');

  await page.evaluate(() => window.vfxFixture.dispose());
  await page.close();

  // The focused VFX page above is separate from the actual UI game state. This
  // second page uses only the normal name/start controls to capture the clean HUD.
  const appPage = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  appPage.on('pageerror', error => errors.push(error.message));
  appPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await appPage.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(gameUrl).origin) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await appPage.goto(gameUrl);
  await appPage.bringToFront();
  await appPage.locator('#home').waitFor({ state: 'visible' });
  await appPage.locator('#start').click();
  await appPage.waitForFunction(() => window.flightSnapshot && (window.flightSnapshot().phase === 'paused' || window.flightSnapshot().elapsed > 0.2), null, { timeout: 10000 });
  if ((await appPage.evaluate(() => window.flightSnapshot().phase)) === 'paused') {
    await appPage.click('#resume');
    await appPage.waitForFunction(() => window.flightSnapshot().phase === 'playing' && window.flightSnapshot().elapsed > 0.2);
  }
  await appPage.screenshot({ path: path.join(evidenceDir, 'flight-clean.png'), animations: 'disabled' });
  results.normalApp = await appPage.evaluate(() => ({ phase: window.flightSnapshot().phase, elapsed: window.flightSnapshot().elapsed, render: window.flightSnapshot().render }));
  if (results.normalApp.phase === 'playing') await appPage.click('#pause');
  await appPage.close();

  // Separate fixture: change only the starting enemy position in the intercepted
  // development module. The real start, simulation collision and result UI run.
  // No fixture or state-writing hook is shipped in the production game.
  results.collisionUi = [];
  for (const mode of ['easy', 'normal']) {
    const collisionPage = await browser.newPage({ viewport: { width: 393, height: 700 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
    collisionPage.on('pageerror', error => errors.push(error.message));
    collisionPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await collisionPage.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(gameUrl).origin) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      if (url.pathname === '/src/simulation.ts') {
        const response = await route.fetch();
        const source = await response.text();
        const original = 'makeAircraft(2, new Vector3(0, 2415, -220))';
        assert(source.includes(original), 'collision fixture recognizes the real starting encounter');
        return route.fulfill({ response, body: source.replace(original, 'makeAircraft(2, new Vector3(0, 2400, -5))') });
      }
      return route.continue();
    });
    await collisionPage.goto(gameUrl);
    await collisionPage.locator('#loading').waitFor({ state: 'hidden' });
    await collisionPage.locator(`input[name="game-mode"][value="${mode}"]`).check();
    await collisionPage.locator('#start').tap();
    await collisionPage.locator('#result').waitFor({ state: 'visible' });
    assert.equal(await collisionPage.locator('#result-score').innerText(), '1,000');
    assert.equal(await collisionPage.locator('#result-contact-points').innerText(), '＋1,000点');
    assert((await collisionPage.locator('#result-reason').innerText()).includes('機体接触'));
    assert.equal(await collisionPage.locator('#result-contact-row').isVisible(), true);
    const snapshot = await collisionPage.evaluate(() => window.flightSnapshot());
    assert.equal(snapshot.endReason, 'collision'); assert.equal(snapshot.contactKills, 1); assert.equal(snapshot.kills, 1);
    assert.equal(snapshot.damageTaken, 0); assert.equal(snapshot.shots, 0);
    await collisionPage.screenshot({ path: path.join(evidenceDir, `collision-${mode}.png`) });
    results.collisionUi.push({ mode, endReason: snapshot.endReason, score: snapshot.score, kills: snapshot.kills, contactKills: snapshot.contactKills, shots: snapshot.shots, damageTaken: snapshot.damageTaken });
    await collisionPage.locator('#result-return-home').tap();
    await collisionPage.locator('#home').waitFor({ state: 'visible' });
    await collisionPage.close();
  }

  assert.deepEqual(errors, [], 'fixture and normal app should have no page/WebGL errors');
  results.status = 'pass';
  results.browser = await browser.version();
  results.viewport = '393x852 CSS px';
  results.deviceScaleFactor = dpr;
  results.errors = errors;
  results.sourceHashes = Object.fromEntries(['src/simulation.ts', 'src/scene.ts', 'src/flight-assist.ts', 'src/flight-view.ts', 'src/main.ts', 'src/style.css', 'src/radar.ts', 'src/types.ts', 'scripts/vfx-check.cjs', 'index.html'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(projectRoot, file))).digest('hex')]));
  fs.writeFileSync(path.join(evidenceDir, 'vfx-check.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({
    status: results.status,
    browser: results.browser,
    deviceScaleFactor: dpr,
    captures: ['flight-clean.png', 'vfx-tracers.png', 'vfx-low-health.png', 'vfx-low-health-paused.png', 'vfx-wreck-ended-start.png', 'vfx-wreck-mid.png', 'vfx-wreck-late.png', 'vfx-wreck-expired.png'],
    fixture: results,
  }, null, 2));
}

main().catch(async error => {
  console.error(error);
  if (browser) {
    try {
      const pages = browser.contexts().flatMap(context => context.pages());
      if (pages[0]) await pages[0].screenshot({ path: path.join(evidenceDir, 'vfx-failure.png') });
    } catch { /* preserve the original error */ }
  }
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  if (server && server.exitCode === null) server.kill('SIGTERM');
});
