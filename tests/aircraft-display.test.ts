import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, BufferGeometry, Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { aimIndicator, aimRadius, aircraftMarkers, AIM_COLORS } from '../src/aim-indicator';
import { projectGunSight } from '../src/gun-sight';
import { createGame } from '../src/simulation';
import { getFlightCameraPose, FLIGHT_FOV } from '../src/flight-view';
import { FlightScene } from '../src/scene';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

function worldPoint(state: ReturnType<typeof createGame>, x: number, y: number, width: number, height: number, depth = 500) {
  const position = new Vector3(), rotation = new Quaternion();
  getFlightCameraPose(state.player, state.mode, position, rotation);
  const tan = Math.tan(FLIGHT_FOV * Math.PI / 360);
  return new Vector3((x / width * 2 - 1) * depth * tan * width / height, (1 - y / height * 2) * depth * tan, -depth).applyQuaternion(rotation).add(position);
}

test('aircraft circle matches Kaisen white/red/blue display in both modes without changing state', () => {
  assert.deepEqual(AIM_COLORS, { clear: '#ffffff', enemy: '#ff645b', friendly: '#6cb8ff' });
  for (const mode of ['easy', 'normal'] as const) for (const [width, height] of [[393, 852], [620, 393], [320, 568]]) {
    const state = createGame(81, mode);
    const sight = mode === 'normal' ? projectGunSight(state.player, width, height) : { x: width / 2, y: height / 2 };
    const enemy = state.enemies[0];
    enemy.position.copy(worldPoint(state, sight.x, sight.y, width, height));
    const friendly = { position: enemy.position.clone(), health: 80, team: 'friendly' as const };
    const before = JSON.stringify(state);
    assert.equal(aimIndicator(state, [], sight, width, height), 'clear');
    assert.equal(aimIndicator(state, [enemy], sight, width, height), 'enemy');
    assert.equal(aimIndicator(state, [enemy, friendly], sight, width, height), 'friendly');
    assert.equal(JSON.stringify(state), before);
    enemy.health = 0;
    assert.equal(aimIndicator(state, [enemy], sight, width, height), 'clear');
    enemy.health = 80;
    enemy.position.copy(worldPoint(state, sight.x, sight.y, width, height, 1600));
    assert.equal(aimIndicator(state, [enemy], sight, width, height), 'clear');
    enemy.position.copy(worldPoint(state, sight.x, sight.y, width, height, -500));
    assert.equal(aimIndicator(state, [enemy], sight, width, height), 'clear');
    const radius = aimRadius(mode, width, height);
    for (const factor of [.999, 1.001]) {
      enemy.position.copy(worldPoint(state, sight.x + radius * factor, sight.y, width, height));
      assert.equal(aimIndicator(state, [enemy], sight, width, height), factor < 1 ? 'enemy' : 'clear');
    }
  }
});

test('manual bore sight stays fixed at 500m when targets approach, disappear or are replaced', () => {
  const state = createGame(82, 'normal');
  for (const [width, height] of [[393, 852], [620, 393]]) for (const pitch of [-.5, 0, .9]) {
    state.player.bank = .45;
    state.player.quaternion.setFromEuler(new Euler(pitch, .2, -.45, 'YXZ'));
    const before = state.player.quaternion.toArray();
    const scene = Object.assign(Object.create(FlightScene.prototype), {
      camera: new PerspectiveCamera(), cssWidth: width, cssHeight: height,
      projectedAim: new Vector3(), canvas: { getBoundingClientRect: () => ({ width, height }) },
    });
    scene.updateCamera(state.player, 'normal');
    const reference = scene.aimScreen();
    assert.deepEqual(reference, { x: projectGunSight(state.player, width, height).x, y: projectGunSight(state.player, width, height).y });
    assert.equal(projectGunSight(state.player, width, height).depth, 500);
    state.enemies[0].position.copy(state.player.position).add(new Vector3(0, 0, -60));
    scene.updateCamera(state.player, 'normal');
    assert.deepEqual(scene.aimScreen(), reference);
    state.enemies[0].health = 0;
    scene.updateCamera(state.player, 'normal');
    assert.deepEqual(scene.aimScreen(), reference);
    assert.deepEqual(state.player.quaternion.toArray(), before);
  }
});

test('aircraft markers use proportional HP and omit dead, distant, behind and edge-clipped aircraft', () => {
  const state = createGame(83, 'easy'), width = 393, height = 852;
  state.enemies = state.enemies.slice(0, 1);
  const enemy = state.enemies[0];
  enemy.position.copy(worldPoint(state, width / 2, height / 2, width, height));
  enemy.health = enemy.maxHealth / 2;
  const markers = aircraftMarkers(state, width, height);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].healthFraction, .5);
  assert.equal(markers[0].distance, Math.round(enemy.position.distanceTo(state.player.position)));
  for (const [x, depth] of [[width * .99, 500], [width / 2, 1600], [width / 2, -500]]) {
    enemy.position.copy(worldPoint(state, x, height / 2, width, height, depth));
    assert.deepEqual(aircraftMarkers(state, width, height), []);
  }
  enemy.position.copy(worldPoint(state, width / 2, height / 2, width, height));
  enemy.health = 0;
  assert.deepEqual(aircraftMarkers(state, width, height), []);
});

test('readable tracers use 45ms segments without modifying flight or bullet state', () => {
  const state = createGame(84), position = new Vector3(10, 20, 30), velocity = new Vector3(0, 0, -800);
  state.bullets = [state.player.id, state.enemies[0].id].map((owner, id) => ({ id, owner, position: position.clone(), previous: position.clone(), velocity: velocity.clone(), life: 1, damage: 5, kind: 'mg' as const, distanceTravelled: 0 }));
  const positions = new Float32Array(12), colors = new Float32Array(12);
  const geometry = new LineSegmentsGeometry().setPositions(positions).setColors(colors);
  const scene = Object.assign(Object.create(FlightScene.prototype), { tracerGeometry: geometry, tracerPositions: positions, tracerColors: colors });
  const before = JSON.stringify(state);
  scene.updateTracers(state);
  assert.deepEqual([...positions], [10, 20, 66, 10, 20, 30, 10, 20, 66, 10, 20, 30]);
  assert.equal(geometry.instanceCount, 2);
  assert.ok(Math.abs(colors[1] - .7) < 1e-6);
  assert.ok(Math.abs(colors[7] - .24) < 1e-6);
  assert.equal(JSON.stringify(state), before);
  state.bullets[0].life=1.49;
  scene.updateTracers(state);
  assert.ok(Math.abs(positions[2]-38)<1e-6,'a newborn tracer never extends behind its muzzle');
  state.bullets.length = 0;
  scene.updateTracers(state);
  assert.equal(geometry.instanceCount, 0);
  geometry.dispose();
});

test('destroyed aircraft live model is hidden while a new flight restores it', () => {
  const aircraft = createGame(85).player;
  const visual = { root: { position: new Vector3(), quaternion: new Quaternion(), visible: true }, propeller: { rotation: { z: 0 } }, ailerons: [{ rotation: { x: 0 } }, { rotation: { x: 0 } }], elevator: { rotation: { x: 0 } } };
  const scene = Object.create(FlightScene.prototype);
  aircraft.health = 0;
  scene.updateAircraft(visual, aircraft, 0);
  assert.equal(visual.root.visible, false);
  aircraft.health = aircraft.maxHealth;
  scene.updateAircraft(visual, aircraft, 0);
  assert.equal(visual.root.visible, true);
});
