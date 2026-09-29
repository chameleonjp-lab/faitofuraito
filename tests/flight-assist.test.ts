import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { createGame, startGame, stepGame } from '../src/simulation';
import { EASY_AIM_RADIUS, FLIGHT_FOV, getFlightCameraPose, projectFlightTarget } from '../src/flight-view';
import { getFlightAssist, PLAYER_MAX_PITCH, shouldAutoFire } from '../src/flight-assist';

const neutral = { turn: 0, climb: 0, fire: false, loop: false };

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

test('offscreen response boosts a full manual turn in both modes and stops when a target is visible', () => {
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
    assert.ok(Math.abs(offscreenTurn / visibleTurn - 1.65) < 1e-8, `${mode}: offscreen turn uses the 1.65 multiplier`);
  }
});
