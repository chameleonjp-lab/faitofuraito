import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { FlightPresentation } from '../src/flight-presentation';
import { createGame, startGame, stepGame } from '../src/simulation';
import { FLIGHT_FOV, getFlightCameraPose } from '../src/flight-view';
import { aimIndicator, aimRadius, aircraftMarkers } from '../src/aim-indicator';
import { projectGunSight } from '../src/gun-sight';
import type { FlightInput, GameMode, GameState } from '../src/types';

// Include every enumerable authoritative field, including all aircraft, rounds,
// events, wrecks, clocks and result fields; do not select only the moving player.
const snapshot = (state: GameState) => JSON.parse(JSON.stringify(state));
const fixedDt = 1 / 60;
const width = 402, height = 874;

function combatFixture(mode: GameMode): GameState {
  const state = createGame(73, mode);
  // A valid state after a low-altitude warning and subsequent climb: the warning
  // continues at safe altitude. Its real countdown will end this short replay.
  state.lowAltitudeRemaining = 2;
  const target = state.enemies[0];
  target.position.y = state.player.position.y;
  target.previous.copy(target.position);
  target.health = 1; // A real newly fired projectile must score a kill.
  startGame(state);
  return state;
}

function tickInput(tick: number): FlightInput {
  return {
    turn: tick > 45 && tick < 90 ? .18 : tick > 90 ? -.1 : 0,
    climb: tick > 45 && tick < 90 ? .15 : 0,
    fire: tick < 90, loop: false, steeringActive: true, viewAspect: width / height,
  };
}

for (const mode of ['easy', 'normal'] as const) {
  test(`${mode}: 30/60/120Hz display replays preserve complete combat at each of 180 fixed ticks`, () => {
    const reference = combatFixture(mode);
    const expected = [];
    for (let tick = 1; tick <= 180; tick++) {
      stepGame(reference, tickInput(tick), fixedDt);
      expected.push(snapshot(reference));
    }
    // Prevent an empty/no-fire/no-result replay from satisfying the comparison.
    assert.ok(expected.some(state => state.bullets.length > 0));
    assert.ok(reference.shots > 0);
    assert.ok(reference.hits > 0);
    assert.equal(reference.kills, 1);
    assert.ok(reference.score > 1000);
    assert.equal(reference.phase, 'ended');
    assert.equal(reference.endReason, 'low-altitude');
    assert.ok(Math.abs(reference.elapsed - 2) < 1e-12);

    for (const refreshHz of [30, 60, 120]) {
      const state = combatFixture(mode), presentation = new FlightPresentation();
      let tick = 0, halfTickBudget = 0;
      // Integer half-ticks avoid a floating-point scheduler tolerance deciding
      // which input belongs to a simulation tick at the different display rates.
      for (let frame = 0; frame < refreshHz * 3; frame++) {
        halfTickBudget += 120 / refreshHz;
        while (halfTickBudget >= 2) {
          const beforeCapture = snapshot(state);
          presentation.capture(state);
          assert.deepEqual(snapshot(state), beforeCapture, 'capture must copy rather than move the live pose');
          stepGame(state, tickInput(++tick), fixedDt);
          assert.deepEqual(snapshot(state), expected[tick - 1], `${refreshHz}Hz changed authoritative tick ${tick}`);
          halfTickBudget -= 2;
        }
        const beforeSample = snapshot(state);
        const view = presentation.sample(state, halfTickBudget / 2);
        // Exercise consumers of the sampled poses as well as sample itself.
        getFlightCameraPose(view.player, mode, new Vector3(), new Quaternion());
        aircraftMarkers(view, width, height);
        const sight = mode === 'easy' ? { x: width / 2, y: height / 2 } : projectGunSight(view.player, width, height);
        aimIndicator(view, view.enemies, sight, width, height);
        assert.deepEqual(snapshot(state), beforeSample, `${refreshHz}Hz display sampling mutated the live state`);
      }
      assert.equal(tick, 180);
      assert.deepEqual(snapshot(state), expected[179]);
    }
  });
}

function displayFixture(mode: GameMode) {
  const state = createGame(73, mode);
  state.enemies = state.enemies.slice(0, 1);
  startGame(state);
  const camera = new PerspectiveCamera(FLIGHT_FOV, width / height, .5, 22000);
  getFlightCameraPose(state.player, mode, camera.position, camera.quaternion);
  camera.updateMatrixWorld();
  const sight = mode === 'easy' ? { x: width / 2, y: height / 2 } : projectGunSight(state.player, width, height);
  const radius = aimRadius(mode, width, height);
  const pointAtCircleOffset = (offset: number) => {
    const depth = 500, tangent = Math.tan(FLIGHT_FOV * Math.PI / 360);
    return new Vector3(
      ((sight.x + offset * radius) / width * 2 - 1) * depth * tangent * width / height,
      (1 - sight.y / height * 2) * depth * tangent,
      -depth,
    ).applyQuaternion(camera.quaternion).add(camera.position);
  };
  return { state, camera, sight, radius, pointAtCircleOffset };
}

for (const mode of ['easy', 'normal'] as const) {
  test(`${mode}: target mesh projection, marker and circle color share alpha 0/.5/1 on entry and exit`, () => {
    for (const crossing of [
      { from: 2, to: .2, offsets: [2, 1.1, .2], colors: ['clear', 'clear', 'enemy'] },
      { from: .2, to: 2, offsets: [.2, 1.1, 2], colors: ['enemy', 'clear', 'clear'] },
    ]) {
      const { state, camera, sight, radius, pointAtCircleOffset } = displayFixture(mode);
      const target = state.enemies[0], presentation = new FlightPresentation();
      target.position.copy(pointAtCircleOffset(crossing.from));
      presentation.capture(state);
      target.position.copy(pointAtCircleOffset(crossing.to));
      state.elapsed = fixedDt;
      const authoritative = snapshot(state);
      for (const [index, alpha] of [0, .5, 1].entries()) {
        const view = presentation.sample(state, alpha);
        // Three's real camera projection is independent of the marker helper.
        const projected = view.enemies[0].position.clone().project(camera);
        const meshX = (projected.x * .5 + .5) * width;
        const meshY = (.5 - projected.y * .5) * height;
        assert.ok(Math.abs(meshX - (sight.x + radius * crossing.offsets[index])) < 1e-9);
        assert.ok(Math.abs(meshY - sight.y) < 1e-9);
        const markers = aircraftMarkers(view, width, height);
        assert.equal(markers.length, 1);
        assert.ok(Math.abs(markers[0].x - meshX) < 1e-9);
        assert.ok(Math.abs(markers[0].y - meshY) < 1e-9);
        assert.equal(aimIndicator(view, view.enemies, sight, width, height), crossing.colors[index]);
        assert.deepEqual(snapshot(state), authoritative);
      }
    }
  });

  test(`${mode}: a new target ID never inherits the removed target's circle color or pose`, () => {
    const { state, sight, pointAtCircleOffset } = displayFixture(mode);
    const removed = state.enemies[0], presentation = new FlightPresentation();
    removed.position.copy(pointAtCircleOffset(0));
    presentation.capture(state);
    const replacement = { ...removed, id: removed.id + 100, position: pointAtCircleOffset(2) };
    state.enemies = [replacement];
    state.elapsed = fixedDt;
    const authoritative = snapshot(state);
    for (const alpha of [0, .5, 1]) {
      const view = presentation.sample(state, alpha);
      assert.deepEqual(view.enemies.map(target => target.id), [replacement.id]);
      assert.deepEqual(view.enemies[0].position.toArray(), replacement.position.toArray());
      assert.equal(aimIndicator(view, view.enemies, sight, width, height), 'clear');
      assert.deepEqual(snapshot(state), authoritative);
    }
  });
}
