import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { createGame } from '../src/simulation';
import { EASY_AIM_RADIUS, FLIGHT_FAR, FLIGHT_FOV, getFlightCameraPose, projectFlightTarget } from '../src/flight-view';
import { radarContacts } from '../src/radar';

test('radar is heading-up, includes distant contacts, and separates altitude from bearing', () => {
  const state = createGame(42), player = state.player, enemy = state.enemies[0];
  player.position.set(0, 500, 0); player.yaw = 0;
  enemy.position.set(1000, 900, -2000);
  const initial = radarContacts(player, [enemy])[0];
  assert.equal(initial.x, 1 / 3); assert.equal(initial.y, -2 / 3); assert.equal(initial.height, 400);
  player.pitch = .9; player.bank = 1.1; player.quaternion.setFromEuler(new Euler(.9, 0, 1.1, 'YXZ'));
  assert.deepEqual(radarContacts(player, [enemy])[0], initial);
  player.yaw = -Math.PI / 2; enemy.position.set(4000, 500, 0);
  const distant = radarContacts(player, [enemy])[0];
  assert.ok(Math.abs(distant.x) < 1e-12); assert.equal(distant.y, -1); assert.equal(distant.outside, true);
  enemy.health = 0; assert.equal(radarContacts(player, [enemy]).length, 0);
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
