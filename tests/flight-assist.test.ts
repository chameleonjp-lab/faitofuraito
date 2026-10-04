import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { createGame, startGame, stepGame } from '../src/simulation';
import { EASY_AIM_RADIUS, FLIGHT_FOV, getFlightCameraPose, projectFlightTarget } from '../src/flight-view';
import { getFlightAssist, PLAYER_MAX_PITCH, predictedShotDirection, shouldAutoFire } from '../src/flight-assist';

const neutral = { turn: 0, climb: 0, fire: false, loop: false };

test('Easy correction stays proportional near the bore and capped outside it',()=>{
 const state=createGame(95,'easy'),target=state.enemies[0],origin=new Vector3(),forward=new Vector3(0,0,-1);
 target.speed=0;
 for(const angle of [0,.004,.04,.08,.12,.17]){
  target.position.set(Math.sin(angle)*500,0,-Math.cos(angle)*500);
  const direction=predictedShotDirection(origin,forward,target,930,1.5);
  const expected=angle>.16?0:Math.min(angle*.35,.028);
  assert.ok(Math.abs(forward.angleTo(direction)-expected)<1e-7);
  assert.ok(Math.abs(direction.length()-1)<1e-10);
 }
});

test('a pilot supplying lead can still score real Easy hits after the reduction',()=>{
 const state=createGame(7,'easy');startGame(state);
 for(let i=0;i<1800 && !state.kills && state.phase==='playing';i++){
  const enemy=state.enemies.find(e=>e.health>0)!;
  const delta=enemy.position.clone().sub(state.player.position);
  const lead=delta.addScaledVector(new Vector3(0,0,-1).applyQuaternion(enemy.quaternion).multiplyScalar(enemy.speed),delta.length()/850).normalize();
  const error=Math.atan2(Math.sin(Math.atan2(-lead.x,-lead.z)-state.player.yaw),Math.cos(Math.atan2(-lead.x,-lead.z)-state.player.yaw));
  stepGame(state,{...neutral,turn:Math.max(-1,Math.min(1,-error/.18)),climb:Math.asin(lead.y)/.95,viewAspect:393/852},1/60);
 }
 assert.ok(state.hits>0 && state.kills>0);
 assert.notEqual(state.endReason,'collision','the score must come from real projectiles');
});

function setTargetOnScreen(
  player: ReturnType<typeof createGame>['player'],
  target: ReturnType<typeof createGame>['enemies'][number],
  aspect: number,
  x: number,
  y: number,
  depth = 500,
  mode: 'normal' | 'easy' = 'easy',
): void {
  const cameraPosition = new Vector3();
  const cameraRotation = new Quaternion();
  getFlightCameraPose(player, mode, cameraPosition, cameraRotation);
  const verticalHalfFov = Math.tan((FLIGHT_FOV * Math.PI) / 360);
  target.position.set(x * depth * verticalHalfFov * aspect, y * depth * verticalHalfFov, -depth)
    .applyQuaternion(cameraRotation)
    .add(cameraPosition);
  target.previous.copy(target.position);
}

test('auto-fire requires a live target in the shared center circle within 1200 metres', () => {
  const state = createGame(81, 'easy');
  const enemy = state.enemies[0];
  const aspect = 393 / 852;
  setTargetOnScreen(state.player, enemy, aspect, 0, 0);
  assert.equal(projectFlightTarget(state.player, enemy.position, aspect, 'easy').inCircle, true);
  assert.equal(shouldAutoFire(state.player, [enemy], 'easy', aspect), true);
  assert.equal(shouldAutoFire(state.player, [enemy], 'normal', aspect), false);

  setTargetOnScreen(state.player, enemy, aspect, EASY_AIM_RADIUS * 2 * 1.01, 0);
  assert.equal(shouldAutoFire(state.player, [enemy], 'easy', aspect), false, 'outside the thin circle does not fire');
  setTargetOnScreen(state.player, enemy, aspect, 0, 0, 1300);
  assert.equal(shouldAutoFire(state.player, [enemy], 'easy', aspect), false, 'a visible target beyond range does not fire');
  enemy.health = 0;
  setTargetOnScreen(state.player, enemy, aspect, 0, 0);
  assert.equal(shouldAutoFire(state.player, [enemy], 'easy', aspect), false, 'a destroyed aircraft is not a target');

  enemy.health = 100;
  setTargetOnScreen(state.player, enemy, aspect, 0, 0, -250);
  assert.equal(shouldAutoFire(state.player, [enemy], 'easy', aspect), false, 'a target behind the camera does not fire');
});

test('visible-target assist fades to zero inside the circle and respects opposing manual input', () => {
  const state = createGame(82, 'easy');
  const enemy = state.enemies[0];
  const aspect = 393 / 852;
  const manual = { ...neutral, turn: -0.3, climb: -0.25, viewAspect: aspect };

  setTargetOnScreen(state.player, enemy, aspect, 0, 0);
  const centered = getFlightAssist(state.player, [enemy], manual, 'easy');
  assert.equal(centered.turn, manual.turn);
  assert.equal(centered.climb, manual.climb);

  setTargetOnScreen(state.player, enemy, aspect, 0.8, 0.3);
  const opposed = getFlightAssist(state.player, [enemy], manual, 'easy');
  assert.equal(opposed.turn, manual.turn, 'manual turn opposite the screen target wins');
  assert.equal(opposed.climb, manual.climb, 'manual climb opposite the screen target wins');

  const pulled = getFlightAssist(state.player, [enemy], neutral, 'easy');
  assert.ok(pulled.turn > 0, 'assist turns toward the visible target without locking the center');
  assert.ok(pulled.climb > 0, 'assist pulls toward its above-center screen position');
});

test('normal mode boosts only offscreen turning and never adds easy aim or autofire', () => {
  const state = createGame(87, 'normal');
  const enemy = state.enemies[0];
  const aspect = 393 / 852;
  const manual = { ...neutral, turn: 0.25, climb: -0.15, viewAspect: aspect };

  enemy.position.set(0, state.player.position.y, 200);
  const searching = getFlightAssist(state.player, [enemy], manual, 'normal');
  assert.equal(searching.turn, manual.turn);
  assert.equal(searching.climb, manual.climb);
  assert.equal(searching.hasVisibleTarget, false);
  assert.equal(searching.responseMultiplier, 1.65);

  setTargetOnScreen(state.player, enemy, aspect, 0.45, -0.25, 500, 'normal');
  const acquired = getFlightAssist(state.player, [enemy], manual, 'normal');
  assert.equal(acquired.turn, manual.turn, 'normal steering is never pulled toward an enemy');
  assert.equal(acquired.climb, manual.climb, 'normal pitch stays entirely under user control');
  assert.equal(acquired.hasVisibleTarget, true);
  assert.equal(acquired.responseMultiplier, 1, 'boost turns off as soon as a live enemy is inside the viewport');
  assert.equal(shouldAutoFire(state.player, [enemy], 'normal', aspect), false);

  enemy.health = 0;
  assert.equal(getFlightAssist(state.player, [enemy], manual, 'normal').responseMultiplier, 1, 'dead enemies do not keep the boost active');
});

test('neutral pitch assist adds the view angle to current pitch and handles banked views', () => {
  const state = createGame(83, 'easy');
  const enemy = state.enemies[0];
  const aspect = 393 / 852;
  state.player.pitch = 0.35;
  state.player.quaternion.setFromEuler(new Euler(state.player.pitch, state.player.yaw, 0, 'YXZ'));
  setTargetOnScreen(state.player, enemy, aspect, 0, 0.8);
  const pulled = getFlightAssist(state.player, [enemy], neutral, 'easy');
  const expectedAbsolutePitch = state.player.pitch + Math.atan(0.8 * Math.tan((FLIGHT_FOV * Math.PI) / 360));
  assert.ok(Math.abs(pulled.climb - expectedAbsolutePitch / PLAYER_MAX_PITCH) < 1e-10);

  state.player.pitch = 0;
  state.player.bank = Math.PI / 2;
  state.player.quaternion.setFromEuler(new Euler(0, state.player.yaw, -state.player.bank, 'YXZ'));
  setTargetOnScreen(state.player, enemy, aspect, 0.8, 0);
  const banked = getFlightAssist(state.player, [enemy], neutral, 'easy');
  assert.ok(banked.climb < 0, 'a screen-right target rolls into a downward pitch correction at 90 degrees bank');
  assert.ok(Number.isFinite(banked.turn) && Number.isFinite(banked.climb));
});

test('manual response rises by 1.65 while living enemies are offscreen, then returns when one is visible', () => {
  const state = createGame(84, 'easy');
  const enemy = state.enemies[0];
  enemy.position.set(0, state.player.position.y, 200);
  enemy.previous.copy(enemy.position);
  const searching = getFlightAssist(state.player, [enemy], neutral, 'easy');
  assert.equal(searching.hasVisibleTarget, false);
  assert.equal(searching.responseMultiplier, 1.65);

  setTargetOnScreen(state.player, enemy, 393 / 852, 0, 0);
  const acquired = getFlightAssist(state.player, [enemy], neutral, 'easy');
  assert.equal(acquired.hasVisibleTarget, true);
  assert.equal(acquired.responseMultiplier, 1);
  assert.equal(getFlightAssist(state.player, [], neutral, 'easy').responseMultiplier, 1);
});

test('offscreen response ramps into a turn in both modes without boosting camera bank or pitch', () => {
  for (const mode of ['normal', 'easy'] as const) {
    const offscreen = createGame(mode === 'normal' ? 85 : 88, mode);
    offscreen.enemies[0].position.set(0, offscreen.player.position.y, 200);
    offscreen.enemies[0].previous.copy(offscreen.enemies[0].position);
    const visible = createGame(mode === 'normal' ? 86 : 89, mode);
    setTargetOnScreen(visible.player, visible.enemies[0], 393 / 852, 0, 0, 500, mode);
    const tick = 1 / 60;

    for (const state of [offscreen, visible]) {
      state.enemies[0].mg = 0;
      state.enemies[0].cannon = 0;
      state.enemies[0].mode = 'flee';
    }
    const offscreenStart = offscreen.player.yaw;
    const visibleStart = visible.player.yaw;
    startGame(offscreen);
    startGame(visible);
    stepGame(offscreen, { ...neutral, turn: 1, viewAspect: 393 / 852 }, tick);
    stepGame(visible, { ...neutral, turn: 1, viewAspect: 393 / 852 }, tick);
    const offscreenTurn = Math.abs(offscreen.player.yaw - offscreenStart);
    const visibleTurn = Math.abs(visible.player.yaw - visibleStart);
    assert.ok(offscreenTurn > visibleTurn && offscreenTurn < visibleTurn * 1.1, `${mode}: the first tick starts the boost gently`);
    assert.equal(offscreen.player.bank, visible.player.bank, 'offscreen boost does not amplify banking');
    assert.equal(offscreen.player.pitch, visible.player.pitch, 'offscreen boost does not amplify pitch');
  }
});

test('deliberate steering wins over easy aim, including same-direction inputs', () => {
  const state = createGame(90, 'easy');
  setTargetOnScreen(state.player, state.enemies[0], 393 / 852, 0.8, 0.4);
  const manual = { ...neutral, turn: 0.4, climb: 0.2, viewAspect: 393 / 852 };
  const result = getFlightAssist(state.player, state.enemies, manual, 'easy');
  assert.equal(result.turn, manual.turn);
  assert.equal(result.climb, manual.climb);
});

test('Easy launch correction is partial, capped, and never fully leads a distant crossing target', () => {
  const state = createGame(91, 'easy'), enemy = state.enemies[0];
  const origin = state.player.position.clone();
  const forward = new Vector3(0, 0, -1);
  enemy.position.copy(origin).add(new Vector3(0, 0, -1000));
  enemy.yaw = -Math.PI / 2;
  enemy.quaternion.setFromEuler(new Euler(0, enemy.yaw, 0, 'YXZ'));
  enemy.speed = 116;
  for (const bulletSpeed of [930, 810]) {
    const direction = predictedShotDirection(origin, forward, enemy, bulletSpeed, 1.5);
    const targetVelocity = new Vector3(0, 0, -1).applyQuaternion(enemy.quaternion).multiplyScalar(enemy.speed);
    const flightTime = 1000 / (-direction.z * bulletSpeed);
    const shot = origin.clone().addScaledVector(direction, bulletSpeed * flightTime);
    const target = enemy.position.clone().addScaledVector(targetVelocity, flightTime);
    assert.ok(shot.distanceTo(target) > 90, 'the pilot must supply the remaining lead');
    assert.ok(direction.x > 0 && forward.angleTo(direction) <= 0.028000001);
  }
  enemy.position.x += 400;
  assert.deepEqual(predictedShotDirection(origin, forward, enemy, 930, 1.5).toArray(), forward.toArray());
});

test('Easy automatic fire still launches but no longer fully compensates an un-aimed distant crossing', () => {
  const state = createGame(92, 'easy'), enemy = state.enemies[0];
  enemy.position.copy(state.player.position); enemy.position.z -= 1000;
  enemy.yaw = -Math.PI / 2;
  enemy.quaternion.setFromEuler(new Euler(0, enemy.yaw, 0, 'YXZ'));
  enemy.speed = 116;
  startGame(state);
  for (let i = 0; i < 85 && !state.hits; i++) {
    // Isolate the gunnery contract from AI tactics: a straight crossing target.
    enemy.aiPhase = 'extend'; enemy.aiPhaseTime = 1;
    enemy.aiWaypoint.copy(enemy.position).add(new Vector3(2000, 0, 0));
    enemy.aiTurn = 0; enemy.aiClimb = 0;
    stepGame(state, { ...neutral, viewAspect: 393 / 852 }, 1 / 60);
  }
  assert.ok(state.shots > 0, 'automatic firing still runs inside the existing circle');
  assert.equal(state.hits, 0, 'a distant crossing needs manual lead');
  assert.ok(state.player.mg < 288); assert.ok(state.player.cannon < 96);
});
