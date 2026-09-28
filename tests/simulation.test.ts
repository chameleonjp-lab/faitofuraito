import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Quaternion, Vector3 } from 'three';
import {
  CANNON_AMMO,
  DURATION,
  MG_AMMO,
  TOTAL_AMMO,
  calculateScore,
  createGame,
  pauseGame,
  resumeGame,
  startGame,
  stepGame,
} from '../src/simulation';

const TICK = 1 / 60;
const neutral = { turn: 0, climb: 0, fire: false, loop: false };

function advance(state: ReturnType<typeof createGame>, input = neutral, ticks = 1): void {
  for (let index = 0; index < ticks; index += 1) stepGame(state, input, TICK);
}

function snapshot(state: ReturnType<typeof createGame>): unknown {
  const vector = (value: Vector3) => value.toArray();
  const quaternion = (value: Quaternion) => value.toArray();
  return {
    phase: state.phase,
    elapsed: state.elapsed,
    kills: state.kills,
    shots: state.shots,
    hits: state.hits,
    loops: state.loops,
    damageTaken: state.damageTaken,
    score: state.score,
    endReason: state.endReason,
    player: {
      position: vector(state.player.position),
      previous: vector(state.player.previous),
      quaternion: quaternion(state.player.quaternion),
      yaw: state.player.yaw,
      pitch: state.player.pitch,
      bank: state.player.bank,
      speed: state.player.speed,
      health: state.player.health,
      mg: state.player.mg,
      cannon: state.player.cannon,
      fireClock: state.player.fireClock,
      cannonClock: state.player.cannonClock,
      loopProgress: state.player.loopProgress,
      loopCooldown: state.player.loopCooldown,
    },
    enemies: state.enemies.map((enemy) => ({
      id: enemy.id,
      position: vector(enemy.position),
      previous: vector(enemy.previous),
      quaternion: quaternion(enemy.quaternion),
      yaw: enemy.yaw,
      pitch: enemy.pitch,
      bank: enemy.bank,
      speed: enemy.speed,
      health: enemy.health,
      mg: enemy.mg,
      cannon: enemy.cannon,
      mode: enemy.mode,
      age: enemy.age,
    })),
    bullets: state.bullets.map((bullet) => ({
      id: bullet.id,
      owner: bullet.owner,
      position: vector(bullet.position),
      previous: vector(bullet.previous),
      velocity: vector(bullet.velocity),
      life: bullet.life,
      damage: bullet.damage,
      kind: bullet.kind,
    })),
    wrecks: state.wrecks.map((wreck) => ({
      id: wreck.id,
      position: vector(wreck.position),
      previous: vector(wreck.previous),
      quaternion: quaternion(wreck.quaternion),
      velocity: vector(wreck.velocity),
      age: wreck.age,
    })),
    events: state.events.map((event) => ({
      id: event.id,
      type: event.type,
      position: vector(event.position),
      owner: event.owner,
    })),
  };
}

test('creates the matching starting encounter and follows the +Y / -Z flight axes', () => {
  const state = createGame(7);
  assert.equal(DURATION, 300);
  assert.equal(state.phase, 'ready');
  assert.deepEqual(state.player.position.toArray(), [0, 2400, 0]);
  assert.deepEqual(state.enemies[0].position.toArray(), [0, 2415, -220]);
  assert.equal(state.player.mg, MG_AMMO);
  assert.equal(state.player.cannon, CANNON_AMMO);
  assert.equal(state.seed, 7);

  startGame(state);
  stepGame(state, { turn: 1, climb: 0.8, fire: false, loop: false }, TICK);
  const forward = new Vector3(0, 0, -1).applyQuaternion(state.player.quaternion);
  const rightWing = new Vector3(1, 0, 0).applyQuaternion(state.player.quaternion);
  assert.ok(state.player.position.x > 0, 'positive turn moves toward the right');
  assert.ok(state.player.position.y > 2400, 'positive climb moves up');
  assert.ok(forward.x > 0 && forward.y > 0, 'quaternion matches rightward climbing motion');
  assert.ok(rightWing.y < 0, 'positive bank lowers the right wing');
});

test('fires both gun pairs at independent cadences and counts each projectile', () => {
  const state = createGame(11);
  startGame(state);
  stepGame(state, { ...neutral, fire: true }, TICK);
  assert.equal(state.player.mg, MG_AMMO - 2);
  assert.equal(state.player.cannon, CANNON_AMMO - 2);
  assert.equal(state.shots, 4);
  assert.equal(state.bullets.length, 4);
  assert.equal(state.events.filter((event) => event.type === 'shot').length, 4);
  const shotEvents = state.events.filter((event) => event.type === 'shot');
  const expectedMuzzles = [
    new Vector3(-0.3, 0.52, -4.25),
    new Vector3(0.3, 0.52, -4.25),
    new Vector3(-2.5, 0, -2.4),
    new Vector3(2.5, 0, -2.4),
  ];
  shotEvents.forEach((event, index) => {
    assert.ok(event.position.clone().sub(state.player.position).distanceTo(expectedMuzzles[index]) < 1e-8);
  });
  const initialIds = state.events.map((event) => event.id);
  assert.deepEqual(initialIds, [1, 2, 3, 4]);

  advance(state, { ...neutral, fire: true }, 5);
  assert.equal(state.shots, 6, 'the MG pair repeats after five 60 Hz ticks');
  assert.equal(state.player.mg, MG_AMMO - 4);
  assert.equal(state.player.cannon, CANNON_AMMO - 2, 'the slower cannon cadence is independent');
  assert.ok(state.events.every((event) => event.id > 4));

  stepGame(state, neutral, TICK);
  stepGame(state, { ...neutral, fire: true }, TICK);
  assert.equal(state.shots, 6, 'releasing and tapping cannot bypass the remaining cooldown');
});

test('an enemy with no rounds enters flee and is not rearmed in place', () => {
  const state = createGame(19);
  const enemy = state.enemies[0];
  enemy.position.set(0, 2400, -40);
  enemy.yaw = Math.PI;
  enemy.quaternion.setFromEuler(new Euler(0, enemy.yaw, 0, 'YXZ'));
  enemy.mg = 1;
  enemy.cannon = 0;
  startGame(state);

  stepGame(state, neutral, TICK);
  assert.equal(enemy.mg, 0);
  assert.equal(enemy.mode, 'flee');
  const originalId = enemy.id;
  advance(state, neutral, 120);
  assert.equal(state.enemies.length, 1);
  assert.equal(state.enemies[0].id, originalId);
  assert.equal(state.enemies[0].mg, 0);
  assert.equal(state.enemies[0].cannon, 0);
  assert.equal(state.enemies[0].mode, 'flee');
});

test('the opening fighter gives a short run-in, then pursuit can catch and fire', () => {
  const state = createGame(20260928);
  startGame(state);
  const openingEnemy = state.enemies[0];
  advance(state, neutral, 60);
  assert.equal(state.player.health, 100, 'the first second is not an immediate lethal attack');
  assert.equal(openingEnemy.mg, MG_AMMO, 'the initial pass gives the player time to line up');
  assert.ok(openingEnemy.position.distanceTo(state.player.position) < 300);

  while (state.phase === 'playing' && state.elapsed < DURATION) stepGame(state, neutral, TICK);
  assert.equal(state.endReason, 'shot-down', 'a straight, non-firing path eventually gives the pursuing enemy a shot');
  assert.ok(state.elapsed < DURATION);
  assert.ok(openingEnemy.mg < MG_AMMO || openingEnemy.cannon < CANNON_AMMO);
});

test('score rises with kills and completed loops, and falls as shots increase', () => {
  assert.equal(TOTAL_AMMO, 1120);
  assert.equal(calculateScore(2, 0, 0), 4000);
  assert.equal(calculateScore(2, TOTAL_AMMO, 0), 2000);
  assert.equal(calculateScore(2, TOTAL_AMMO + 100, 0), 2000);
  assert.ok(calculateScore(2, 20, 0) > calculateScore(2, 600, 0));
  assert.ok(calculateScore(3, 600, 0) > calculateScore(2, 600, 0));
  assert.equal(calculateScore(2, 600, 3) - calculateScore(2, 600, 0), 450);
  assert.equal(calculateScore(1, 100, 2, 10), calculateScore(1, 100, 2) - 100);
  assert.equal(calculateScore(1, 1120, 0, 1000), 0, 'damage deductions clamp the final score');
});

test('accelerator and brake move a persistent speed target with drag and turn response', () => {
  const state = createGame(17);
  startGame(state);
  advance(state, { ...neutral, accelerate: true }, 120);
  assert.ok(state.player.speed > 120, 'holding accelerate raises speed toward the selected maximum');
  const fastSpeed = state.player.speed;
  advance(state, neutral, 120);
  assert.ok(state.player.speed >= fastSpeed, 'releasing throttle keeps the higher target selected');

  const turnAtHighSpeed = createGame(18);
  turnAtHighSpeed.player.speed = 141;
  startGame(turnAtHighSpeed);
  stepGame(turnAtHighSpeed, { ...neutral, turn: 1 }, TICK);
  const highYawChange = Math.abs(turnAtHighSpeed.player.yaw);

  const slowed = createGame(18);
  slowed.player.speed = 141;
  startGame(slowed);
  advance(slowed, { ...neutral, brake: true }, 120);
  const slowedSpeed = slowed.player.speed;
  const yawBefore = slowed.player.yaw;
  stepGame(slowed, { ...neutral, turn: 1 }, TICK);
  assert.ok(slowedSpeed < 141);
  assert.ok(Math.abs(slowed.player.yaw - yawBefore) > highYawChange, 'braking improves turn response from high speed');

  const drag = createGame(20);
  startGame(drag);
  advance(drag, { ...neutral, turn: 1, climb: 1 }, 120);
  assert.ok(drag.player.speed < 110, 'turning and climbing create resistance while the selected target stays unchanged');
});

test('enemy damage thresholds reduce speed while player damage reduces score only', () => {
  const speedAtHealth = (health: number): number => {
    const state = createGame(21);
    const enemy = state.enemies[0];
    enemy.health = health;
    enemy.age = 2;
    enemy.mode = 'flee';
    startGame(state);
    advance(state, neutral, 240);
    return enemy.speed;
  };
  assert.ok(speedAtHealth(70) < speedAtHealth(71));
  assert.ok(speedAtHealth(50) < speedAtHealth(51));
  assert.ok(speedAtHealth(30) < speedAtHealth(31));
  assert.ok(speedAtHealth(30) >= 65, 'damage slowdown does not push an enemy below stall speed');

  const playerAtHealth = (health: number): number => {
    const state = createGame(21);
    state.player.health = health;
    const enemy = state.enemies[0];
    enemy.mg = 0;
    enemy.cannon = 0;
    enemy.mode = 'flee';
    startGame(state);
    advance(state, neutral, 120);
    return state.player.speed;
  };
  assert.equal(playerAtHealth(30), playerAtHealth(100), 'player damage has no speed penalty');

  const state = createGame(22);
  startGame(state);
  state.kills = 1;
  state.shots = 100;
  state.loops = 2;
  state.bullets.push({
    id: 3,
    owner: state.enemies[0].id,
    position: new Vector3(0, 2400, 10),
    previous: new Vector3(0, 2400, 10),
    velocity: new Vector3(0, 0, -1000),
    life: 2,
    damage: 25,
    kind: 'mg',
  });
  stepGame(state, neutral, TICK);
  assert.equal(state.damageTaken, 25);
  assert.equal(state.score, calculateScore(1, 100, 2, 25));
});

test('counts only completed loops, enforces cooldown, and requires a fresh press', () => {
  const state = createGame(23);
  startGame(state);
  advance(state, { ...neutral, loop: true }, 360);
  assert.equal(state.loops, 1);
  assert.equal(state.player.loopProgress, 0);
  assert.ok(state.player.loopCooldown > 0);
  assert.equal(state.events.filter((event) => event.type === 'loop').length, 0, 'per-step events do not persist');

  advance(state, { ...neutral, loop: true }, 240);
  assert.equal(state.loops, 1, 'holding the loop control does not retrigger');
  assert.equal(state.player.loopCooldown, 0);
  stepGame(state, neutral, TICK);
  stepGame(state, { ...neutral, loop: true }, TICK);
  assert.ok(state.player.loopProgress > 0, 'a new press can start the next loop');

  const interrupted = createGame(29);
  startGame(interrupted);
  advance(interrupted, { ...neutral, loop: true }, 180);
  assert.ok(interrupted.player.loopProgress > 0 && interrupted.player.loopProgress < 1);
  interrupted.player.health = 0;
  stepGame(interrupted, neutral, TICK);
  assert.equal(interrupted.loops, 0);
  assert.equal(interrupted.endReason, 'shot-down');
});

test('a complete loop remains a continuous flight path and overtakes a tailing opponent', () => {
  const state = createGame(53);
  startGame(state);
  const enemy = state.enemies[0];
  enemy.position.set(0, 2400, 250);
  enemy.previous.copy(enemy.position);
  enemy.quaternion.setFromEuler(new Euler(0, 0, 0, 'YXZ'));
  enemy.speed = 110;
  state.player.health = 1000;
  const start = state.player.position.clone();

  advance(state, { ...neutral, loop: true }, 150);
  assert.ok(state.player.position.y > start.y + 100, 'the aircraft climbs through the first half of the loop');
  assert.ok(state.player.loopProgress > 0 && state.player.loopProgress < 1);
  advance(state, { ...neutral, loop: true }, 150);

  assert.equal(state.loops, 1);
  assert.ok(state.player.position.distanceTo(start) < 100, 'the full loop returns near the starting point through motion');
  assert.ok(enemy.position.z < state.player.position.z - 100, 'the delayed pursuer overshoots and ends ahead');
  const enemyForward = new Vector3(0, 0, -1).applyQuaternion(enemy.quaternion);
  const toPlayer = state.player.position.clone().sub(enemy.position);
  assert.ok(enemyForward.dot(toPlayer) < 0, 'the player is behind the enemy along its heading');
});

test('sweeps a fast shot against an aircraft crossing its path', () => {
  const state = createGame(31);
  startGame(state);
  const enemy = state.enemies[0];
  enemy.position.set(7, 2400, -50);
  enemy.yaw = Math.PI / 2;
  enemy.quaternion.setFromEuler(new Euler(0, enemy.yaw, 0, 'YXZ'));
  enemy.speed = 141;
  enemy.mg = 0;
  enemy.cannon = 0;
  enemy.mode = 'flee';
  state.bullets.push({
    id: 3,
    owner: state.player.id,
    position: new Vector3(0, 2400, -5),
    previous: new Vector3(0, 2400, -5),
    velocity: new Vector3(0, 0, -1000),
    life: 2,
    damage: 100,
    kind: 'cannon',
  });

  stepGame(state, neutral, 0.1);
  assert.equal(state.kills, 1);
  assert.equal(state.hits, 1);
  assert.equal(state.enemies.length, 0);
  assert.ok(state.events.some((event) => event.type === 'kill'));
});

test('a killed plane leaves one falling, rotating wreck that pauses and expires at five seconds', () => {
  const enemyKill = createGame(59);
  startGame(enemyKill);
  const enemy = enemyKill.enemies[0];
  enemy.position.set(0, 2400, -20);
  enemy.health = 1;
  enemy.mg = 0;
  enemy.cannon = 0;
  enemy.mode = 'flee';
  for (const id of [99, 100]) {
    enemyKill.bullets.push({
      id,
      owner: enemyKill.player.id,
      position: new Vector3(0, 2400, -5),
      previous: new Vector3(0, 2400, -5),
      velocity: new Vector3(0, 0, -1000),
      life: 2,
      damage: 25,
      kind: 'mg',
    });
  }
  stepGame(enemyKill, neutral, TICK);
  assert.equal(enemyKill.kills, 1);
  assert.equal(enemyKill.events.filter((event) => event.type === 'kill').length, 1, 'death and kill are committed once');
  assert.equal(enemyKill.enemies.length, 0);
  assert.equal(enemyKill.wrecks.length, 1);

  pauseGame(enemyKill);
  stepGame(enemyKill, neutral, TICK);
  const pausedWreck = snapshot(enemyKill);
  advance(enemyKill, neutral, 60);
  assert.deepEqual(snapshot(enemyKill), pausedWreck, 'wreck physics also stops while paused');
  resumeGame(enemyKill);
  advance(enemyKill, neutral, 300);
  assert.equal(enemyKill.wrecks.length, 0, 'the wreck is removed after five seconds of active simulation');

  const shotDown = createGame(60);
  startGame(shotDown);
  shotDown.player.health = 10;
  shotDown.bullets.push({
    id: 99,
    owner: shotDown.enemies[0].id,
    position: new Vector3(0, 2400, 10),
    previous: new Vector3(0, 2400, 10),
    velocity: new Vector3(0, 0, -1000),
    life: 2,
    damage: 40,
    kind: 'cannon',
  });
  stepGame(shotDown, neutral, TICK);
  assert.equal(shotDown.endReason, 'shot-down');
  assert.equal(shotDown.damageTaken, 10, 'overkill counts only health actually lost');
  assert.equal(shotDown.enemies.length, 0, 'all surviving enemies leave on player destruction');
  assert.equal(shotDown.wrecks.length, 1);
  const wreck = shotDown.wrecks[0];
  const originalElapsed = shotDown.elapsed;
  const originalScore = shotDown.score;
  const originalQuaternion = wreck.quaternion.clone();
  stepGame(shotDown, neutral, TICK);
  assert.ok(wreck.age > 0 && wreck.position.y < 2400, 'the result screen advances physical fall');
  assert.ok(wreck.quaternion.angleTo(originalQuaternion) > 0, 'the wreck tumbles');
  assert.equal(shotDown.elapsed, originalElapsed, 'post-result wreck time does not extend the match');
  assert.equal(shotDown.score, originalScore, 'post-result wreck time does not change score');
  advance(shotDown, neutral, 299);
  assert.equal(shotDown.wrecks.length, 0);
});

test('pause freezes the complete simulation and resume continues it', () => {
  const state = createGame(37);
  startGame(state);
  stepGame(state, { ...neutral, fire: true }, TICK);
  pauseGame(state);
  stepGame(state, { turn: 1, climb: 1, fire: true, loop: true }, TICK);
  const frozen = snapshot(state);
  advance(state, { turn: 1, climb: 1, fire: true, loop: true }, 60);
  assert.deepEqual(snapshot(state), frozen);
  assert.equal(state.events.length, 0);

  resumeGame(state);
  stepGame(state, neutral, TICK);
  assert.equal(state.phase, 'playing');
  assert.ok(state.elapsed > 0);
  assert.ok(state.bullets.some((bullet) => bullet.owner === state.player.id));
});

test('lets the last projectile settle before ending on ammo, and keeps shot-down priority', () => {
  const state = createGame(41);
  startGame(state);
  state.player.mg = 0;
  state.player.cannon = 1;
  state.enemies[0].position.set(0, 2400, -4000);
  stepGame(state, { ...neutral, fire: true }, TICK);
  assert.equal(state.shots, 1, 'one remaining cannon round emits one projectile');
  assert.equal(state.kills, 0);
  assert.equal(state.phase, 'playing', 'the paired second gun round still has its bounded flight');
  advance(state, neutral, 100);
  assert.equal(state.phase, 'ended');
  assert.equal(state.endReason, 'ammo');

  const finalKill = createGame(42);
  startGame(finalKill);
  finalKill.player.mg = 0;
  finalKill.player.cannon = 2;
  finalKill.enemies[0].position.set(0, 2400, -20);
  finalKill.enemies[0].health = 30;
  stepGame(finalKill, { ...neutral, fire: true }, TICK);
  assert.equal(finalKill.shots, 2);
  assert.equal(finalKill.kills, 1, 'the last salvo resolves before ammo end');
  assert.equal(finalKill.endReason, 'ammo');

  const priority = createGame(43);
  priority.player.health = 0;
  priority.player.mg = 0;
  priority.player.cannon = 0;
  startGame(priority);
  stepGame(priority, neutral, TICK);
  assert.equal(priority.endReason, 'shot-down');
});

test('the timer takes priority over empty ammo at the same boundary', () => {
  const state = createGame(47);
  startGame(state);
  state.player.mg = 0;
  state.player.cannon = 0;
  state.elapsed = DURATION - TICK / 2;
  stepGame(state, neutral, TICK);
  assert.equal(state.elapsed, DURATION);
  assert.equal(state.endReason, 'time');
});

test('same seed and fixed inputs replay the same spawn and combat state', () => {
  const first = createGame(123456);
  const second = createGame(123456);
  startGame(first);
  startGame(second);
  for (let tick = 0; tick < 900; tick += 1) {
    const input = {
      turn: Math.sin(tick / 17) * 0.3,
      climb: Math.sin(tick / 31) * 0.15,
      fire: tick % 4 === 0,
      loop: tick === 120,
    };
    stepGame(first, input, TICK);
    stepGame(second, input, TICK);
  }
  assert.deepEqual(snapshot(first), snapshot(second));
  assert.ok(first.enemies.length <= 5);
});
