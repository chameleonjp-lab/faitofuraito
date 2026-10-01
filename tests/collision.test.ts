import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler } from 'three';
import { calculateScore, createGame, pauseGame, resumeGame, startGame, stepGame } from '../src/simulation';

const neutral = { turn: 0, climb: 0, fire: false, loop: false };

test('contact gives exactly 1000 extra points and immediately ends both modes once', () => {
  for (const mode of ['normal', 'easy'] as const) {
    const state = createGame(111, mode), enemy = state.enemies[0];
    state.kills = 2; state.shots = 600; state.loops = 3; state.damageTaken = 40;
    state.player.health = 60;
    const before = calculateScore(2, 600, 3, 40);
    enemy.position.copy(state.player.position);
    enemy.mg = enemy.cannon = 0;
    const second = { ...enemy, id: 3, position: enemy.position.clone(), previous: enemy.previous.clone(), quaternion: enemy.quaternion.clone() };
    state.enemies.push(second);
    startGame(state);
    stepGame(state, { ...neutral, fire: true }, 1 / 60);
    assert.equal(state.phase, 'ended'); assert.equal(state.endReason, 'collision');
    assert.equal(state.score, before + 1000);
    assert.equal(state.kills, 3); assert.equal(state.contactKills, 1);
    assert.equal(state.damageTaken, 40, 'contact does not create a damage deduction');
    assert.equal(state.shots, 600, 'no salvo starts after contact');
    assert.equal(state.player.health, 0); assert.equal(enemy.health, 0);
    assert.equal(state.enemies.length, 0); assert.equal(state.bullets.length, 0);
    assert.equal(state.wrecks.length, 2);
    assert.equal(state.events.filter(e => e.type === 'end').length, 1);
    for (let i = 0; i < 360; i++) stepGame(state, neutral, 1 / 60);
    assert.equal(state.score, before + 1000); assert.equal(state.kills, 3);
    assert.equal(state.wrecks.length, 0);
  }
  assert.equal(calculateScore(1, 0, 0, 100, 1), 1000, 'a zero previous score still gets the full 1000');
});

test('contact checks swept shapes, close misses and pause boundaries', () => {
  for (const mode of ['normal', 'easy'] as const) {
    const state = createGame(112, mode), enemy = state.enemies[0];
    enemy.position.copy(state.player.position); enemy.position.z -= 25;
    enemy.yaw = Math.PI; enemy.quaternion.setFromEuler(new Euler(0, Math.PI, 0, 'YXZ'));
    enemy.mg = enemy.cannon = 0;
    startGame(state); pauseGame(state);
    stepGame(state, neutral, .25);
    assert.equal(state.phase, 'paused'); assert.equal(state.contactKills, 0);
    resumeGame(state); stepGame(state, neutral, .25);
    assert.equal(state.endReason, 'collision', 'opposite paths intersect even if end positions pass each other');

    const miss = createGame(113, mode), missEnemy = miss.enemies[0];
    missEnemy.position.copy(miss.player.position);
    missEnemy.position.y += 20; missEnemy.position.z -= 25;
    missEnemy.yaw = Math.PI; missEnemy.quaternion.setFromEuler(new Euler(0, Math.PI, 0, 'YXZ'));
    missEnemy.mg = missEnemy.cannon = 0;
    startGame(miss); stepGame(miss, neutral, .25);
    assert.equal(miss.phase, 'playing'); assert.equal(miss.contactKills, 0);
  }
});

test('dead aircraft cannot grant a contact kill', () => {
  const state = createGame(114), enemy = state.enemies[0];
  enemy.position.copy(state.player.position); enemy.health = 0;
  startGame(state); stepGame(state, neutral, 1 / 60);
  assert.equal(state.phase, 'playing'); assert.equal(state.kills, 0); assert.equal(state.contactKills, 0);
});
