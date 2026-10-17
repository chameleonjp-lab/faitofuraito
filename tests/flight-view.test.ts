import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { createGame } from '../src/simulation';
import { EASY_AIM_RADIUS, FLIGHT_FAR, FLIGHT_FOV, FLIGHT_VISIBILITY_RANGE, getFlightCameraPose, projectFlightTarget } from '../src/flight-view';
import { RADAR_RANGE, radarContacts } from '../src/radar';
import { createFlightController, ENEMY_MAX_PITCH, normalizeAngle, updateAircraftMotion, updatePlayerLoop, updateQuaternion } from '../src/flight';

const CAMERA_TICK = 1 / 60;
const neutralSteering = { turn: 0, climb: 0, fire: false, loop: false, steeringActive: true };

function cameraForward(player: ReturnType<typeof createGame>['player'], mode: 'easy' | 'normal'): Vector3 {
  const position = new Vector3(), rotation = new Quaternion();
  getFlightCameraPose(player, mode, position, rotation);
  return new Vector3(0, 0, -1).applyQuaternion(rotation).normalize();
}

function cameraAngle(before: Vector3, after: Vector3): number {
  return Math.atan2(new Vector3().crossVectors(before, after).length(), before.dot(after));
}

function expectedAuthority(speed: number): number {
  const lowSpeed = speed <= 85 ? .92 + ((speed - 65) / 20) * .23
    : speed <= 110 ? 1.15 - ((speed - 85) / 25) * .15 : 1;
  return lowSpeed * Math.max(.78, Math.min(1, 1 - Math.max(0, speed - 115) * .008));
}

function manualStep(player: ReturnType<typeof createGame>['player'], turn: number, climb: number,
  responseMultiplier = 1, mode: 'easy' | 'normal' = 'normal') {
  const control = createFlightController(player);
  const input = { ...neutralSteering, turn, climb };
  updatePlayerLoop(player, control, input, input, false, CAMERA_TICK, 110, 141, responseMultiplier, mode);
}

test('radar is heading-up, includes distant contacts, and separates altitude from bearing', () => {
  const state = createGame(42), player = state.player, enemy = state.enemies[0];
  player.position.set(0, 500, 0); player.yaw = 0;
  enemy.position.set(500, 900, -1000);
  const initial = radarContacts(player, [enemy])[0];
  assert.equal(initial.x, 1 / 3); assert.equal(initial.y, -2 / 3); assert.equal(initial.height, 400);
  player.pitch = .9; player.bank = 1.1; player.quaternion.setFromEuler(new Euler(.9, 0, -1.1, 'YXZ'));
  const banked = radarContacts(player, [enemy])[0];
  assert.equal(banked.x, initial.x); assert.equal(banked.y, initial.y); assert.equal(banked.height, initial.height);
  player.yaw = -Math.PI / 2; enemy.position.set(4000, 500, 0);
  const distant = radarContacts(player, [enemy])[0];
  assert.ok(Math.abs(distant.x) < 1e-12); assert.equal(distant.y, -1); assert.equal(distant.outside, true);
  enemy.health = 0; assert.equal(radarContacts(player, [enemy]).length, 0);
});

test('radar, view and altitude distance use one 1500-metre visibility boundary in both modes', () => {
  assert.equal(RADAR_RANGE, FLIGHT_VISIBILITY_RANGE);
  const state = createGame(44), player = state.player, enemy = state.enemies[0];
  player.position.set(0, 2400, 0);
  for (const mode of ['easy', 'normal'] as const) {
    for (const distance of [1499, 1501]) {
      enemy.position.set(0, 2400, -distance);
      const contact = radarContacts(player, [enemy], mode)[0];
      const projection = projectFlightTarget(player, enemy.position, 393 / 852, mode);
      assert.equal(contact.outside, distance > 1500);
      assert.equal(contact.visible, projection.visible);
      assert.equal(projection.visible, distance < 1500);
    }
    enemy.position.set(0, 3400, -1200);
    assert.equal(radarContacts(player, [enemy], mode)[0].outside, true, 'large altitude difference counts toward range');
    enemy.position.set(0, 2400, 300);
    const behind = radarContacts(player, [enemy], mode)[0];
    assert.equal(behind.outside, false); assert.equal(behind.visible, false);
  }
});

test('camera roll and its sideways offset are reduced without changing the aircraft pose', () => {
  const player = createGame(45).player;
  player.bank = .72;
  player.quaternion.setFromEuler(new Euler(0, 0, -player.bank, 'YXZ'));
  const before = player.quaternion.toArray();
  const camera = new PerspectiveCamera();
  getFlightCameraPose(player, 'easy', camera.position, camera.quaternion);
  const attitude = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  assert.ok(Math.abs(attitude.z) < player.bank * .5);
  assert.ok(Math.abs(camera.position.x - player.position.x) < 4);
  assert.deepEqual(player.quaternion.toArray(), before);
});

test('manual input keeps the camera-forward turn rate equal in both modes and at steep pitches', () => {
  for (const mode of ['easy', 'normal'] as const) for (const speed of [65, 85, 110, 141])
    for (const pitch of [-.9, 0, .9]) for (const strength of [.25, .45, .6]) for (const direction of [-1, 1]) {
      const vertical = createGame(71).player;
      vertical.speed = speed; vertical.pitch = pitch; updateQuaternion(vertical);
      const beforeVertical = cameraForward(vertical, mode);
      manualStep(vertical, 0, direction * strength, 1, mode);
      const verticalRate = cameraAngle(beforeVertical, cameraForward(vertical, mode));
      const expected = strength * .82 * expectedAuthority(speed) * CAMERA_TICK;
      assert.ok(Math.abs(verticalRate - expected) < 1e-12,
        `${mode} vertical pitch=${pitch} speed=${speed} strength=${strength} sign=${direction}: ${verticalRate} vs ${expected}`);

      const yawed = createGame(72).player;
      yawed.speed = speed; yawed.pitch = pitch;
      updateQuaternion(yawed);
      const beforeYawed = cameraForward(yawed, mode);
      manualStep(yawed, direction * strength, 0, 1, mode);
      const horizontalRate = cameraAngle(beforeYawed, cameraForward(yawed, mode));
      assert.ok(Math.abs(horizontalRate - expected) < 1e-12,
        `${mode} horizontal pitch=${pitch} speed=${speed} strength=${strength} sign=${direction}: ${horizontalRate} vs ${expected}`);
    }
});

test('manual diagonal controls share a circular camera-rate budget and offscreen boost stays yaw-only', () => {
  const step = .82 * expectedAuthority(110) * CAMERA_TICK;
  for (const mode of ['easy', 'normal'] as const) {
    const pitchPlane = createGame(74).player, boostedPitchPlane = createGame(74).player;
    pitchPlane.speed = boostedPitchPlane.speed = 110;
    const before = cameraForward(pitchPlane, mode);
    manualStep(pitchPlane, 0, .6, 1, mode); manualStep(boostedPitchPlane, 0, .6, 1.65, mode);
    const ordinaryPitchRate = cameraAngle(before, cameraForward(pitchPlane, mode));
    const boostedPitchRate = cameraAngle(before, cameraForward(boostedPitchPlane, mode));
    assert.ok(Math.abs(ordinaryPitchRate - .6 * step) < 1e-12);
    assert.ok(Math.abs(boostedPitchRate - ordinaryPitchRate) < 1e-12,
      `${mode} offscreen response cannot accelerate vertical manual pitch`);

    const diagonal = createGame(73).player; diagonal.speed = 110;
    const beforeDiagonal = cameraForward(diagonal, mode);
    manualStep(diagonal, 1, 1, 1, mode);
    assert.ok(Math.abs(cameraAngle(beforeDiagonal, cameraForward(diagonal, mode)) - step) < 1e-12,
      `${mode} diagonal input is capped by one circular camera-rate budget`);

    const ordinaryYaw = createGame(75).player, boostedYaw = createGame(75).player;
    ordinaryYaw.speed = boostedYaw.speed = 110;
    const ordinaryBaseline = createGame(75).player, boostedBaseline = createGame(75).player;
    ordinaryBaseline.speed = boostedBaseline.speed = 110;
    manualStep(ordinaryBaseline, 0, 0, 1, mode); manualStep(boostedBaseline, 0, 0, 1.65, mode);
    manualStep(ordinaryYaw, .6, 0, 1, mode); manualStep(boostedYaw, .6, 0, 1.65, mode);
    const ordinaryYawRate = cameraAngle(cameraForward(ordinaryBaseline, mode), cameraForward(ordinaryYaw, mode));
    const boostedYawRate = cameraAngle(cameraForward(boostedBaseline, mode), cameraForward(boostedYaw, mode));
    assert.ok(Math.abs(ordinaryYawRate - .6 * step) < 1e-12);
    assert.ok(Math.abs(boostedYawRate - 1.65 * ordinaryYawRate) < 1e-12,
      `${mode} offscreen 1.65 multiplier applies to yaw only`);
  }
});

test('manual pitch stays within limits and direction reversals remain rate-bounded', () => {
  const step = .82 * expectedAuthority(110) * CAMERA_TICK;
  for (const direction of [-1, 1]) {
    const limited = createGame(80).player;
    limited.speed = 110; limited.pitch = direction * .95; updateQuaternion(limited);
    const before = limited.pitch;
    manualStep(limited, 0, direction * .6);
    assert.ok(Math.abs(limited.pitch) <= .95 + 1e-12);
    assert.ok(Math.abs(limited.pitch - before) <= step + 1e-12, 'outward pressure at the limit cannot snap pitch');

    const reversing = createGame(81).player;
    reversing.speed = 110; reversing.pitch = direction * .4; updateQuaternion(reversing);
    const start = reversing.pitch;
    manualStep(reversing, 0, -direction * .5);
    assert.ok(Math.abs(reversing.pitch - start) <= .5 * step + 1e-12);
    assert.equal(Math.sign(reversing.pitch), direction, 'one opposite input tick does not snap through level');
  }
});

test('manual horizontal input holds pitch instead of adding neutral leveling to its camera turn', () => {
  for (const turn of [.45, .01]) {
    const player = createGame(82).player;
    player.speed = 110; player.pitch = .9; updateQuaternion(player);
    const before = cameraForward(player, 'normal');
    manualStep(player, turn, 0, 1, 'normal');
    const measured = cameraAngle(before, cameraForward(player, 'normal'));
    const expected = Math.abs(turn) * .82 * expectedAuthority(110) * CAMERA_TICK;
    assert.ok(Math.abs(measured - expected) < 1e-12,
      `turn=${turn} horizontal manual input should not add pitch recovery: ${measured} vs ${expected}`);
  }
});

test('manual neutral pitch recovery remains bounded to one angular rate step', () => {
  const player = createGame(83).player;
  player.speed = 110; player.pitch = .9; updateQuaternion(player);
  const beforePitch = player.pitch;
  manualStep(player, 0, 0, 1, 'normal');
  assert.ok(Math.abs(player.pitch - beforePitch) <= .82 * expectedAuthority(110) * CAMERA_TICK + 1e-12);
  assert.ok(player.pitch < beforePitch, 'a genuinely neutral input still returns pitch toward level');
});

test('non-manual AI yaw retains the legacy multiplication order exactly', () => {
  const aircraft = createGame(84).enemies[0];
  aircraft.speed = 85; aircraft.pitch = 0; aircraft.yaw = -3.14; aircraft.bank = .3;
  updateQuaternion(aircraft);
  const turn = -.35, climb = .35, dt = 1 / 60;
  let expectedYaw = aircraft.yaw;
  for (let tick = 0; tick < 120; tick += 1) {
    const lowSpeedAuthority = aircraft.speed <= 85
      ? .92 + ((aircraft.speed - 65) / 20) * .23
      : aircraft.speed <= 110 ? 1.15 - ((aircraft.speed - 85) / 25) * .15 : 1;
    const highSpeedLoad = Math.max(.78, Math.min(1, 1 - Math.max(0, aircraft.speed - 115) * .008));
    const authority = lowSpeedAuthority * highSpeedLoad;
    expectedYaw = normalizeAngle(expectedYaw - turn * .82 * authority * 1 * dt);
    updateAircraftMotion(aircraft, turn, climb, dt, 112, false, 141, ENEMY_MAX_PITCH);
  }
  assert.equal(aircraft.yaw, expectedYaw, 'legacy AI yaw arithmetic stays byte-identical tick to tick');
});

test('bank rolls the camera around its optical axis without pulling the sightline sideways', () => {
  for (const mode of ['easy', 'normal'] as const) {
    const level = createGame(76).player, banked = createGame(76).player;
    level.pitch = banked.pitch = .4; level.yaw = banked.yaw = .3;
    banked.bank = .72; updateQuaternion(level); updateQuaternion(banked);
    const levelForward = cameraForward(level, mode), bankForward = cameraForward(banked, mode);
    assert.ok(levelForward.distanceTo(bankForward) < 1e-12, `${mode} bank cannot rotate camera forward`);
    const levelRotation = new Quaternion();
    const bankRotation = new Quaternion();
    getFlightCameraPose(level, mode, new Vector3(), levelRotation);
    getFlightCameraPose(banked, mode, new Vector3(), bankRotation);
    assert.ok(Math.abs(levelRotation.angleTo(bankRotation) - .72 * .45) < 1e-12,
      `${mode} retains 45% bank as screen roll`);
  }
});

test('Easy camera-assist pitch remains an absolute target command and NPC climb stays legacy absolute', () => {
  const player = createGame(77, 'easy').player;
  const control = createFlightController(player);
  const assisted = { turn: 0, climb: .4, fire: false, loop: false };
  const raw = { turn: 0, climb: 0, fire: false, loop: false };
  const expected = (assisted.climb * .95 - player.pitch) * (1 - Math.exp(-CAMERA_TICK * 4.2));
  updatePlayerLoop(player, control, assisted, raw, false, CAMERA_TICK, 110, 141, 1, 'easy');
  assert.ok(Math.abs(player.pitch - expected) < 1e-12, 'target-assist climb remains an absolute attitude command');

  const enemy = createGame(78).enemies[0];
  const enemyExpected = ( .35 * ENEMY_MAX_PITCH - enemy.pitch) * (1 - Math.exp(-CAMERA_TICK * 4.2));
  updateAircraftMotion(enemy, .2, .35, CAMERA_TICK, 112, false, 141, ENEMY_MAX_PITCH);
  assert.ok(Math.abs(enemy.pitch - enemyExpected) < 1e-12, 'AI climb remains on the pre-pilot absolute-pitch path');
});

test('cancelling a loop beyond vertical retains the continuous pitch branch and applies at most one manual rate step', () => {
  const player = createGame(79).player, control = createFlightController(player);
  const held = { ...neutralSteering, steeringRevision: 1 };
  updatePlayerLoop(player, control, held, held, true, CAMERA_TICK, 110, 141, 1, 'normal');
  for (let tick = 0; tick < 90; tick += 1) {
    updatePlayerLoop(player, control, held, held, false, CAMERA_TICK, 110, 141, 1, 'normal');
  }
  assert.ok(player.loopProgress > 0.29 && player.loopProgress < 0.31, 'test cancels after the nose has passed vertical');
  const beforePitch = player.pitch, beforeSpeed = player.speed;
  const beforePosition = player.position.clone(), beforeCamera = new Quaternion();
  getFlightCameraPose(player, 'normal', new Vector3(), beforeCamera);
  const changed = { ...neutralSteering, turn: .5, steeringRevision: 2 };
  updatePlayerLoop(player, control, changed, changed, false, CAMERA_TICK, 110, 141, 1, 'normal');
  const maxStep = .82 * expectedAuthority(beforeSpeed) * CAMERA_TICK;
  assert.ok(Math.abs(player.pitch - beforePitch) <= maxStep + 1e-12,
    'the continuous loop pitch changes by no more than one manual rate step on cancellation');
  assert.ok(player.position.distanceTo(beforePosition) < 3, 'cancellation continues from the current position');
  const afterCamera = new Quaternion(); getFlightCameraPose(player, 'normal', new Vector3(), afterCamera);
  assert.ok(beforeCamera.angleTo(afterCamera) < .08, 'camera orientation has no Euler-branch snap');
});

test('targeting projection matches Three camera at different pitches and viewport shapes', () => {
  const player = createGame(42).player;
  for (const aspect of [393 / 852, 852 / 393, 1]) for (const pitch of [-.5, 0, .9]) for (const mode of ['easy', 'normal'] as const) {
    player.quaternion.setFromEuler(new Euler(pitch, .4, .2, 'YXZ'));
    const target = new Vector3(20, 40, -500).applyQuaternion(player.quaternion).add(player.position);
    const camera = new PerspectiveCamera(FLIGHT_FOV, aspect, .1, FLIGHT_FAR);
    getFlightCameraPose(player, mode, camera.position, camera.quaternion); camera.updateMatrixWorld(true);
    const actual = target.clone().project(camera), projected = projectFlightTarget(player, target, aspect, mode);
    assert.ok(Math.abs(actual.x - projected.x) < 1e-12); assert.ok(Math.abs(actual.y - projected.y) < 1e-12);
  }
});

test('auto-fire circle uses shortest screen edge and excludes behind/far targets', () => {
  const player = createGame(42).player;
  for (const aspect of [393 / 852, 852 / 393]) {
    const camera = new PerspectiveCamera(FLIGHT_FOV, aspect, .1, FLIGHT_FAR);
    getFlightCameraPose(player, 'easy', camera.position, camera.quaternion); camera.updateMatrixWorld(true);
    const forward = new Vector3(0, 0, -450).applyQuaternion(player.quaternion).add(player.position);
    assert.equal(projectFlightTarget(player, forward, aspect, 'easy').inCircle, true);
    for (const axis of ['x', 'y'] as const) for (const multiplier of [.999, 1.001]) {
      const point = new Vector3(0, 0, .99);
      point[axis] = EASY_AIM_RADIUS * 2 * multiplier / (axis === 'x' ? Math.max(1, aspect) : Math.max(1, 1 / aspect));
      point.unproject(camera);
      assert.equal(projectFlightTarget(player, point, aspect, 'easy').inCircle, multiplier < 1);
    }
    for (const depth of [-100, 7000]) {
      const point = new Vector3(0, 0, -depth).applyQuaternion(camera.quaternion).add(camera.position);
      assert.equal(projectFlightTarget(player, point, aspect, 'easy').visible, false);
    }
  }
});
