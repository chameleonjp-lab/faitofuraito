import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { createGame } from '../src/simulation';
import { EASY_AIM_RADIUS, FLIGHT_FAR, FLIGHT_FOV, FLIGHT_VISIBILITY_RANGE, getFlightCameraPose, projectFlightTarget } from '../src/flight-view';
import { RADAR_RANGE, radarContacts } from '../src/radar';

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
