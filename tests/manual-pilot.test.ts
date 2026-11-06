import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { manualLeadCommand } from '../browser-tests/manual-pilot';
import { createGame, startGame, stepGame } from '../src/simulation';
import { forwardOf, updateQuaternion } from '../src/flight';

test('the test pilot preserves an already aligned attitude through the real manual-rate flight controller', () => {
  for (const [pitch, yaw] of [[.2, 0], [-.2, .35], [.4, -.35]]) {
    const state = createGame(73, 'easy');
    state.player.pitch = pitch; state.player.yaw = yaw;
    updateQuaternion(state.player);
    const forward = forwardOf(state.player);
    state.enemies[0].position.copy(state.player.position).addScaledVector(forward, 500);
    state.enemies[0].previous.copy(state.enemies[0].position);
    const command = manualLeadCommand(state.player.position, state.player.quaternion,
      state.enemies[0].position, new Vector3());
    startGame(state);
    stepGame(state, { ...command, steeringActive: true, fire: false, loop: false, viewAspect: 393 / 852 }, 1 / 60);
    assert.ok(Math.abs(state.player.pitch - pitch) < 1e-12, 'aligned aim is a zero pitch-rate command');
    assert.ok(Math.abs(state.player.yaw - yaw) < 1e-12);
  }
});
