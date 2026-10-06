import assert from 'node:assert/strict';

// The display clock is deliberately not the authority. Compare every serialized
// gameplay field, including bullet positions/lifetimes and enemy AI timers.
export function assertFrozenWorld(before: { game: Record<string, unknown> }, after: { game: Record<string, unknown> }): void {
  const { phase: _beforePhase, ...beforeWorld } = before.game;
  const { phase: _afterPhase, ...afterWorld } = after.game;
  assert.deepEqual(afterWorld, beforeWorld, 'authoritative world advanced during suspension');
}

export function assertReleasedControls(controls: Record<string, unknown>): void {
  assert.deepEqual(controls, {
    turn: 0, climb: 0, steerPointer: null, throttle: 0, throttlePointer: null,
    heldPointers: { fire: [], loop: [], accelerate: [], brake: [] }, keys: [],
  }, 'held controls survived suspension or resumed without a fresh input');
}
