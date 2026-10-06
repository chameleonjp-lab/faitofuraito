import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startGame, stepGame } from '../src/simulation';
import { assertFrozenWorld, assertReleasedControls } from '../browser-tests/pause-safety-assertions';

function activeSnapshot() {
  const game = createGame(20260928, 'normal');
  startGame(game);
  for (let i = 0; i < 20; i++) stepGame(game, { turn: 0, climb: 0, fire: true, loop: false }, 1 / 60);
  assert.ok(game.bullets.length > 0);
  assert.ok(game.enemies.length > 0);
  return { game: JSON.parse(JSON.stringify(game)), displayElapsed: '0:00' };
}

test('freeze comparison permits only the playing-to-paused phase change', () => {
  const before = activeSnapshot(), after = structuredClone(before);
  after.game.phase = 'paused';
  assertFrozenWorld(before, after);
});

const mutations: Array<[string, (game: any) => void]> = [
  ['world position', game => { game.player.position.x += 1; }],
  ['bullet lifetime', game => { game.bullets[0].life -= 1 / 60; }],
  ['enemy AI timer', game => { game.enemies[0].aiPhaseTime += 1 / 60; }],
  ['reload countdown', game => { game.player.reloadTicksRemaining += 1; }],
  ['score', game => { game.score += 1; }],
  ['authoritative time', game => { game.elapsed += 1 / 60; }],
];
for (const [label, mutate] of mutations) test(`negative fixture rejects ${label} advancing behind a frozen display`, () => {
  const before = activeSnapshot(), after = structuredClone(before);
  after.game.phase = 'paused';
  mutate(after.game);
  assert.equal(after.displayElapsed, before.displayElapsed);
  assert.throws(() => assertFrozenWorld(before, after), /authoritative world advanced/);
});

test('negative fixtures reject a resumed held key, pointer, or throttle command', () => {
  const neutral = { turn: 0, climb: 0, steerPointer: null, throttle: 0, throttlePointer: null,
    heldPointers: { fire: [], loop: [], accelerate: [], brake: [] }, keys: [] };
  assertReleasedControls(neutral);
  for (const stale of [
    { ...neutral, keys: ['Space'] },
    { ...neutral, heldPointers: { ...neutral.heldPointers, fire: [7] } },
    { ...neutral, throttle: 1, throttlePointer: 9 },
  ]) assert.throws(() => assertReleasedControls(stale), /held controls survived/);
});
