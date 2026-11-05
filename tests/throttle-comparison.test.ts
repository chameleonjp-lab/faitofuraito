import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTwoEnemyFlightComparison } from '../scripts/throttle-comparison-assertions.mjs';

function snapshots() {
  const before = {
    mode: 'normal', phase: 'playing', elapsed: 0.2, score: 0, bullets: 0,
    player: { position: [0, 2400, -22], speed: 110, health: 80 },
    enemies: [{ id: 2, position: [0, 2415, -242], health: 80 }],
  };
  const after = structuredClone(before);
  after.enemies.push({ id: 3, position: [90, 2415, -462], health: 80 });
  return { before, after };
}

test('flight comparison accepts the requested extra opening enemy', () => {
  const { before, after } = snapshots();
  assert.doesNotThrow(() => assertTwoEnemyFlightComparison(before, after));
});

test('flight comparison still rejects changes to the player, score, bullets, or original enemy', () => {
  for (const change of [
    (s: ReturnType<typeof snapshots>['after']) => { s.player.speed = 111; },
    (s: ReturnType<typeof snapshots>['after']) => { s.score = 1000; },
    (s: ReturnType<typeof snapshots>['after']) => { s.bullets = 1; },
    (s: ReturnType<typeof snapshots>['after']) => { s.enemies[0].position[0] = 5; },
  ]) {
    const { before, after } = snapshots(); change(after);
    assert.throws(() => assertTwoEnemyFlightComparison(before, after));
  }
});

test('flight comparison rejects a missing, duplicate, dead, or overlapping opening enemy', () => {
  for (const change of [
    (s: ReturnType<typeof snapshots>['after']) => { s.enemies.pop(); },
    (s: ReturnType<typeof snapshots>['after']) => { s.enemies.push(structuredClone(s.enemies[1])); },
    (s: ReturnType<typeof snapshots>['after']) => { s.enemies[1].id = s.enemies[0].id; },
    (s: ReturnType<typeof snapshots>['after']) => { s.enemies[1].id = 1; },
    (s: ReturnType<typeof snapshots>['after']) => { s.enemies[1].id = 2.5; },
    (s: ReturnType<typeof snapshots>['after']) => { s.enemies[1].health = 0; },
    (s: ReturnType<typeof snapshots>['after']) => { s.enemies[1].position = [...s.enemies[0].position]; },
    (s: ReturnType<typeof snapshots>['after']) => { s.enemies[1].position = [0.01, 2415, -242]; },
    (s: ReturnType<typeof snapshots>['after']) => { s.enemies[1].position = [100, 2415, -242]; },
  ]) {
    const { before, after } = snapshots(); change(after);
    assert.throws(() => assertTwoEnemyFlightComparison(before, after));
  }
});
