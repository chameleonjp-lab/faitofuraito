import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { createGame, startGame, stepGame } from '../src/simulation';
import { EASY_AIM_RADIUS, FLIGHT_FOV, getFlightCameraPose, projectFlightTarget } from '../src/flight-view';
import { getFlightAssist, PLAYER_MAX_PITCH, predictedShotDirection, shouldAutoFire } from '../src/flight-assist';

const neutral = { turn: 0, climb: 0, fire: false, loop: false };

test('NPC prediction stays proportional near the bore and capped outside it',()=>{
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

test('a pilot supplying lead can score real Easy hits with straight player rounds',()=>{
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

test('deliberate steering wins over easy aim, including same-direction inputs', () => {
  const state = createGame(90, 'easy');
  setTargetOnScreen(state.player, state.enemies[0], 393 / 852, 0.8, 0.4);
  const manual = { ...neutral, turn: 0.4, climb: 0.2, viewAspect: 393 / 852 };
  const result = getFlightAssist(state.player, state.enemies, manual, 'easy');
  assert.equal(result.turn, manual.turn);
  assert.equal(result.climb, manual.climb);
});

test('NPC launch prediction remains partial, capped, and never fully leads a distant crossing target', () => {
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
