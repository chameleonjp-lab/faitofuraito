import assert from 'node:assert/strict';

export function assertTwoEnemyFlightComparison(before, after) {
  assert.equal(before.enemies.length, 1, 'The fixed baseline starts with one enemy');
  assert.equal(after.enemies.length, 2, 'The candidate must start with two enemies');
  const [original, added] = after.enemies;
  // Only the requested extra aircraft may differ from the fixed baseline.
  // Keep comparing every player, weapon, score, timer, and original-enemy field.
  assert.deepEqual({ ...after, enemies: [original] }, before, 'Existing controlled flight state differs');
  assert.ok(Number.isInteger(added.id) && added.id > original.id,
    'The added enemy needs a new identity after the existing aircraft');
  assert.ok(added.health > 0, 'The added enemy must be alive');
  assert.equal(added.position.length, 3);
  assert.ok(added.position.every(Number.isFinite));
  assert.ok(Math.hypot(...added.position.map((v, i) => v - original.position[i])) > 100,
    'The opening enemies must remain separated by more than 100 metres');
}
