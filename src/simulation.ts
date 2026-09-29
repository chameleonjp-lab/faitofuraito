import { Euler, Quaternion, Vector3 } from 'three';
import { getFlightAssist, PLAYER_MAX_PITCH, shouldAutoFire } from './flight-assist';
import type { Aircraft, Bullet, FlightInput, GameEvent, GameMode, GameState, Wreck } from './types';

export const DURATION = 300;
export const MG_AMMO = 1000;
export const CANNON_AMMO = 120;
export const TOTAL_AMMO = MG_AMMO + CANNON_AMMO;

export const CRUISE_SPEED = 110;
export const MAX_SPEED = 141;
export const STALL_SPEED = 65;
export const MAX_ACTIVE_ENEMIES = 5;

const MIN_SPEED = STALL_SPEED;
const INITIAL_HEALTH = 100;
const LOOP_DURATION = 5;
const LOOP_COOLDOWN = 2;
const LOOP_MIN_SPEED = STALL_SPEED;
const LOOP_REACTION_DELAY = LOOP_DURATION + 0.25;
const THROTTLE_ADJUST_RATE = 18;
const SPAWN_INTERVAL = 14;
const INITIAL_RUN_IN = 1.5;
const ENEMY_PURSUIT_SPEED = 116;
const ENEMY_EVADE_SPEED = 118;
const ENEMY_FLEE_SPEED = 123;
const WRECK_LIFETIME = 5;
const BULLET_LIFETIME = 1.5;
const MG_RATE = 12;
const CANNON_RATE = 4;
const MG_MUZZLE_SPEED = 820;
const CANNON_MUZZLE_SPEED = 700;
const MG_DAMAGE = 5;
const CANNON_DAMAGE = 25;
const ENEMY_MAX_PITCH = 0.62;
const MAX_YAW_RATE = 0.82;
const MAX_BANK = 0.72;
const EPSILON = 1e-8;
const ENDED_WRECK_MAX_DT = 1 / 30;

const WORLD_FORWARD = new Vector3(0, 0, -1);
const LOCAL_HIT_SPHERES = [
  { center: new Vector3(0, 0, -3.8), radius: 3.0 },
  { center: new Vector3(0, 0, 0), radius: 4.6 },
  { center: new Vector3(0, 0, 3.4), radius: 2.7 },
  { center: new Vector3(4.0, 0, 0.25), radius: 2.1 },
  { center: new Vector3(-4.0, 0, 0.25), radius: 2.1 },
];

interface SimulationMeta {
  nextEntityId: number;
  nextEventId: number;
  randomState: number;
  nextSpawnAt: number;
  replacementSpawnAt: number | null;
  playerTargetSpeed: number;
  loopHeld: boolean;
  playerLoopActive: boolean;
  loopStartYaw: number;
  loopStartPitch: number;
  loopReactionDelay: Map<number, { remaining: number; target: Vector3 }>;
  wreckedAircraftIds: Set<number>;
}

const metadata = new WeakMap<GameState, SimulationMeta>();
const wreckAngularVelocities = new WeakMap<Wreck, Vector3>();

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function normalizeAngle(angle: number): number {
  let wrapped = (angle + Math.PI) % (Math.PI * 2);
  if (wrapped < 0) wrapped += Math.PI * 2;
  return wrapped - Math.PI;
}

function normalizedSeed(seed: number): number {
  const value = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0x6d2b79f5;
  return value || 0x6d2b79f5;
}

function getMeta(state: GameState): SimulationMeta {
  let meta = metadata.get(state);
  if (!meta) {
    const greatestId = Math.max(
      state.player.id,
      ...state.enemies.map((enemy) => enemy.id),
      ...state.bullets.map((bullet) => bullet.id),
    );
    meta = {
      nextEntityId: greatestId + 1,
      nextEventId: 1,
      randomState: normalizedSeed(state.seed),
      nextSpawnAt: state.elapsed + SPAWN_INTERVAL,
      replacementSpawnAt: null,
      playerTargetSpeed: CRUISE_SPEED,
      loopHeld: false,
      playerLoopActive: false,
      loopStartYaw: state.player.yaw,
      loopStartPitch: state.player.pitch,
      loopReactionDelay: new Map(),
      wreckedAircraftIds: new Set(),
    };
    metadata.set(state, meta);
  }
  return meta;
}

function random(meta: SimulationMeta): number {
  let value = meta.randomState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  meta.randomState = value >>> 0 || 0x6d2b79f5;
  return meta.randomState / 0x100000000;
}

function quaternionFor(aircraft: Aircraft): Quaternion {
  // Positive bank means a right turn with the right wing down. In local
  // coordinates that is a negative rotation about +Z (the nose points -Z).
  return new Quaternion().setFromEuler(
    new Euler(aircraft.pitch, aircraft.yaw, -aircraft.bank, 'YXZ'),
  );
}

function updateQuaternion(aircraft: Aircraft): void {
  aircraft.quaternion.copy(quaternionFor(aircraft));
}

function forwardOf(aircraft: Aircraft): Vector3 {
  return WORLD_FORWARD.clone().applyQuaternion(aircraft.quaternion).normalize();
}

function makeAircraft(id: number, position: Vector3, yaw = 0): Aircraft {
  const aircraft: Aircraft = {
    id,
    position,
    previous: position.clone(),
    quaternion: new Quaternion(),
    yaw,
    pitch: 0,
    bank: 0,
    speed: CRUISE_SPEED,
    health: INITIAL_HEALTH,
    mg: MG_AMMO,
    cannon: CANNON_AMMO,
    fireClock: 0,
    cannonClock: 0,
    loopProgress: 0,
    loopCooldown: 0,
    mode: 'pursue',
    age: 0,
  };
  updateQuaternion(aircraft);
  return aircraft;
}

function emitEvent(
  state: GameState,
  type: GameEvent['type'],
  position: Vector3,
  owner: number,
): void {
  const meta = getMeta(state);
  state.events.push({
    id: meta.nextEventId++,
    type,
    position: position.clone(),
    owner,
  });
}

function createWreck(state: GameState, aircraft: Aircraft): void {
  const meta = getMeta(state);
  if (meta.wreckedAircraftIds.has(aircraft.id)) return;
  meta.wreckedAircraftIds.add(aircraft.id);

  const velocity = forwardOf(aircraft).multiplyScalar(aircraft.speed * 0.55);
  velocity.y -= 4;
  const wreck: Wreck = {
    id: meta.nextEntityId++,
    position: aircraft.position.clone(),
    previous: aircraft.position.clone(),
    quaternion: aircraft.quaternion.clone(),
    velocity,
    age: 0,
  };
  const direction = wreck.id % 2 === 0 ? 1 : -1;
  wreckAngularVelocities.set(wreck, new Vector3(0.45, 0.9 * direction, 0.7).multiplyScalar(1.4));
  state.wrecks.push(wreck);
}

function updateWrecks(state: GameState, dt: number): void {
  const survivors: Wreck[] = [];
  for (const wreck of state.wrecks) {
    wreck.previous.copy(wreck.position);
    wreck.velocity.y -= 9.81 * dt;
    wreck.position.addScaledVector(wreck.velocity, dt);
    const angularVelocity = wreckAngularVelocities.get(wreck) ?? new Vector3(0.5, 1, 0.7);
    const angularSpeed = angularVelocity.length();
    if (angularSpeed > EPSILON) {
      wreck.quaternion.multiply(
        new Quaternion().setFromAxisAngle(angularVelocity.clone().normalize(), angularSpeed * dt),
      ).normalize();
    }
    wreck.age += dt;
    if (wreck.age < WRECK_LIFETIME - EPSILON) survivors.push(wreck);
    else wreckAngularVelocities.delete(wreck);
  }
  state.wrecks = survivors;
}

function finishGame(state: GameState, reason: NonNullable<GameState['endReason']>): void {
  if (state.phase === 'ended') return;
  if (reason === 'shot-down') {
    createWreck(state, state.player);
    state.enemies = [];
  }
  state.bullets = [];
  state.phase = 'ended';
  state.endReason = reason;
  emitEvent(state, 'end', state.player.position, state.player.id);
}

function createBullet(
  state: GameState,
  shooter: Aircraft,
  kind: Bullet['kind'],
  gunIndex: number,
): Bullet {
  const meta = getMeta(state);
  const forward = forwardOf(shooter);
  const muzzleSpeed = kind === 'mg' ? MG_MUZZLE_SPEED : CANNON_MUZZLE_SPEED;
  const damage = kind === 'mg' ? MG_DAMAGE : CANNON_DAMAGE;
  const gunSide = gunIndex === 0 ? -1 : 1;
  const gunOffset = kind === 'mg'
    ? new Vector3(gunSide * 0.3, 0.52, -4.25)
    : new Vector3(gunSide * 2.5, 0, -2.4);
  const position = shooter.position.clone().add(gunOffset.applyQuaternion(shooter.quaternion));
  return {
    id: meta.nextEntityId++,
    owner: shooter.id,
    position,
    previous: position.clone(),
    velocity: forward.multiplyScalar(shooter.speed + muzzleSpeed),
    life: BULLET_LIFETIME,
    damage,
    kind,
  };
}

function emitWeaponSalvo(state: GameState, aircraft: Aircraft, kind: Bullet['kind']): number {
  const available = kind === 'mg' ? aircraft.mg : aircraft.cannon;
  const rounds = Math.min(2, available);
  for (let index = 0; index < rounds; index += 1) {
    const bullet = createBullet(state, aircraft, kind, index);
    state.bullets.push(bullet);
    if (aircraft.id === state.player.id) state.shots += 1;
    emitEvent(state, 'shot', bullet.position, aircraft.id);
  }
  return rounds;
}

function fireWeapons(state: GameState, aircraft: Aircraft, firing: boolean, dt: number): void {
  aircraft.fireClock = Math.max(0, aircraft.fireClock - dt);
  aircraft.cannonClock = Math.max(0, aircraft.cannonClock - dt);
  const unlimitedPlayerAmmo = state.mode === 'easy' && aircraft.id === state.player.id;
  if (aircraft.mg > 0 || unlimitedPlayerAmmo) {
    if (firing && aircraft.fireClock <= EPSILON) {
      const rounds = emitWeaponSalvo(state, aircraft, 'mg');
      if (!unlimitedPlayerAmmo) aircraft.mg -= rounds;
      aircraft.fireClock = 1 / MG_RATE;
    }
  }

  if (aircraft.cannon > 0 || unlimitedPlayerAmmo) {
    if (firing && aircraft.cannonClock <= EPSILON) {
      const rounds = emitWeaponSalvo(state, aircraft, 'cannon');
      if (!unlimitedPlayerAmmo) aircraft.cannon -= rounds;
      aircraft.cannonClock = 1 / CANNON_RATE;
    }
  }
}

function updateAircraftMotion(
  aircraft: Aircraft,
  turnInput: number,
  climbInput: number,
  dt: number,
  preferredSpeed: number,
  looping = false,
  speedCeiling = MAX_SPEED,
  maxPitch = ENEMY_MAX_PITCH,
  responseMultiplier = 1,
): void {
  const turn = clamp(turnInput, -1, 1);
  const climb = clamp(climbInput, -1, 1);
  const lowSpeedAuthority = aircraft.speed <= STALL_SPEED + 20
    ? 0.92 + ((aircraft.speed - STALL_SPEED) / 20) * 0.23
    : aircraft.speed <= CRUISE_SPEED
      ? 1.15 - ((aircraft.speed - (STALL_SPEED + 20)) / (CRUISE_SPEED - (STALL_SPEED + 20))) * 0.15
      : 1;
  // A lightweight load penalty gives the faster end a heavier feel without
  // claiming an exact historical turn-rate curve.
  const highSpeedLoad = clamp(1 - Math.max(0, aircraft.speed - 115) * 0.008, 0.78, 1);
  const authority = lowSpeedAuthority * highSpeedLoad;

  if (!looping) {
    const targetPitch = climb * maxPitch;
    const pitchBlend = 1 - Math.exp(-dt * 4.2 * responseMultiplier);
    aircraft.pitch += (targetPitch - aircraft.pitch) * pitchBlend;
    aircraft.yaw = normalizeAngle(aircraft.yaw - turn * MAX_YAW_RATE * authority * responseMultiplier * dt);
    const targetBank = turn * MAX_BANK;
    const bankBlend = 1 - Math.exp(-dt * 5.5 * responseMultiplier);
    aircraft.bank += (targetBank - aircraft.bank) * bankBlend;
  } else {
    aircraft.bank += (0 - aircraft.bank) * (1 - Math.exp(-dt * 3));
  }

  const turnDrag = Math.abs(turn) * 2.7;
  const climbDrag = Math.max(0, climb) * 2.1;
  const loopDrag = looping ? 4.8 : 0;
  const pitchEnergy = Math.sin(aircraft.pitch) * 2.6;
  const trim = (preferredSpeed - aircraft.speed) * 0.72;
  aircraft.speed = clamp(
    aircraft.speed + (trim - turnDrag - climbDrag - loopDrag - pitchEnergy) * dt,
    MIN_SPEED,
    Math.max(MIN_SPEED, speedCeiling),
  );

  updateQuaternion(aircraft);
  aircraft.position.addScaledVector(forwardOf(aircraft), aircraft.speed * dt);
}

function shortestYawInput(aircraft: Aircraft, direction: Vector3): number {
  const horizontalLength = Math.hypot(direction.x, direction.z);
  if (horizontalLength < EPSILON) return 0;
  const desiredYaw = Math.atan2(-direction.x, -direction.z);
  const error = normalizeAngle(desiredYaw - aircraft.yaw);
  return clamp(-error / 0.7, -1, 1);
}

function desiredFlightInput(aircraft: Aircraft, target: Vector3): { turn: number; climb: number } {
  const towardTarget = target.clone().sub(aircraft.position);
  const horizontalLength = Math.hypot(towardTarget.x, towardTarget.z);
  if (towardTarget.lengthSq() < EPSILON) return { turn: 0, climb: 0 };
  const desiredPitch = Math.atan2(towardTarget.y, Math.max(horizontalLength, EPSILON));
  return {
    turn: shortestYawInput(aircraft, towardTarget),
    climb: clamp(desiredPitch / ENEMY_MAX_PITCH, -1, 1),
  };
}

function updateEnemyMode(
  enemy: Aircraft,
  playerPosition: Vector3,
  playerForward: Vector3,
): void {
  if (enemy.mg <= 0 && enemy.cannon <= 0) {
    enemy.mode = 'flee';
    return;
  }
  if (enemy.mode === 'flee') return;

  const toEnemy = enemy.position.clone().sub(playerPosition);
  const distance = toEnemy.length();
  const playerAiming = distance > EPSILON ? playerForward.dot(toEnemy.normalize()) : 0;
  if (enemy.health <= 40 || (enemy.mode === 'pursue' && distance < 95 && playerAiming > 0.72)) {
    enemy.mode = 'evade';
  } else if (enemy.mode === 'evade' && enemy.health > 40 && (distance > 180 || playerAiming < 0.15)) {
    enemy.mode = 'pursue';
  }
}

function enemyTarget(enemy: Aircraft, playerPosition: Vector3, playerForward: Vector3): Vector3 {
  if (enemy.mode === 'pursue') return playerPosition;

  const away = enemy.position.clone().sub(playerPosition);
  if (away.lengthSq() < EPSILON) away.copy(playerForward).negate();
  away.normalize();
  const right = new Vector3(-away.z, 0, away.x);
  if (right.lengthSq() < EPSILON) right.set(1, 0, 0);
  right.normalize();
  const sign = enemy.id % 2 === 0 ? 1 : -1;
  return enemy.position
    .clone()
    .addScaledVector(away, enemy.mode === 'flee' ? 360 : 240)
    .addScaledVector(right, sign * (enemy.mode === 'flee' ? 180 : 120))
    .add(new Vector3(0, enemy.mode === 'flee' ? 55 : 25, 0));
}

function enemyCanFire(enemy: Aircraft, targetPosition: Vector3): boolean {
  if (enemy.mg <= 0 && enemy.cannon <= 0) return false;
  const toTarget = targetPosition.clone().sub(enemy.position);
  const distance = toTarget.length();
  if (distance < EPSILON || distance > 650) return false;
  return forwardOf(enemy).dot(toTarget.multiplyScalar(1 / distance)) >= 0.985;
}

function spawnEnemy(state: GameState): void {
  const meta = getMeta(state);
  const heading = forwardOf(state.player);
  const right = new Vector3(-heading.z, 0, heading.x).normalize();
  const angle = (random(meta) * 2 - 1) * 0.72;
  const distance = 230 + random(meta) * 100;
  const approach = heading.multiplyScalar(Math.cos(angle)).addScaledVector(right, Math.sin(angle)).normalize();
  const position = state.player.position
    .clone()
    .addScaledVector(approach, distance)
    .add(new Vector3(0, (random(meta) * 2 - 1) * 45, 0));
  const yawOffset = (random(meta) * 2 - 1) * 0.12;
  const yaw = normalizeAngle(state.player.yaw + angle + yawOffset);
  const enemy = makeAircraft(meta.nextEntityId++, position, yaw);
  state.enemies.push(enemy);
  emitEvent(state, 'spawn', enemy.position, enemy.id);
}

function advanceSpawnClock(state: GameState, lastLivingEnemyKilled = false): void {
  const meta = getMeta(state);
  if (state.mode === 'easy' && state.elapsed >= DURATION) return;
  if (lastLivingEnemyKilled) meta.replacementSpawnAt = state.elapsed + 3;

  if (meta.replacementSpawnAt !== null) {
    // A replacement takes precedence over the regular cadence. Consume any
    // regular deadline that overlaps its wait rather than spawning early or
    // double-spawning when both clocks expire together.
    while (state.elapsed + EPSILON >= meta.nextSpawnAt) meta.nextSpawnAt += SPAWN_INTERVAL;
    if (state.elapsed + EPSILON >= meta.replacementSpawnAt) {
      if (state.enemies.length < MAX_ACTIVE_ENEMIES) spawnEnemy(state);
      meta.replacementSpawnAt = null;
    }
    return;
  }

  while (state.elapsed + EPSILON >= meta.nextSpawnAt) {
    if (state.enemies.length < MAX_ACTIVE_ENEMIES) spawnEnemy(state);
    meta.nextSpawnAt += SPAWN_INTERVAL;
  }
}

function segmentSphereEntry(start: Vector3, end: Vector3, radius: number): number | null {
  const delta = end.clone().sub(start);
  const a = delta.lengthSq();
  const c = start.lengthSq() - radius * radius;
  if (c <= 0) return 0;
  if (a < EPSILON) return null;
  const b = 2 * start.dot(delta);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const entry = (-b - root) / (2 * a);
  const exit = (-b + root) / (2 * a);
  if (entry >= 0 && entry <= 1) return entry;
  if (exit >= 0 && exit <= 1) return exit;
  return null;
}

function sweptHitTime(bullet: Bullet, aircraft: Aircraft, aircraftStepFraction = 1): number | null {
  let earliest: number | null = null;
  for (const sphere of LOCAL_HIT_SPHERES) {
    // The fixed 60 Hz step keeps rotation small; use the current local offset
    // at both ends while sweeping the moving aircraft center relative to the shot.
    const offset = sphere.center.clone().applyQuaternion(aircraft.quaternion);
    const previousCenter = aircraft.previous.clone().add(offset);
    const currentCenter = aircraft.previous
      .clone()
      .lerp(aircraft.position, aircraftStepFraction)
      .add(offset);
    const relativeStart = bullet.previous.clone().sub(previousCenter);
    const relativeEnd = bullet.position.clone().sub(currentCenter);
    const entry = segmentSphereEntry(relativeStart, relativeEnd, sphere.radius);
    if (entry !== null && (earliest === null || entry < earliest)) earliest = entry;
  }
  return earliest;
}

function damageAircraft(
  state: GameState,
  target: Aircraft,
  bullet: Bullet,
  hitPosition: Vector3,
): void {
  const wasAlive = target.health > 0;
  const previousHealth = target.health;
  target.health = Math.max(0, target.health - bullet.damage);
  if (target.id === state.player.id) state.damageTaken += previousHealth - target.health;
  emitEvent(state, 'hit', hitPosition, bullet.owner);
  emitEvent(state, 'damage', hitPosition, target.id);

  if (bullet.owner === state.player.id) state.hits += 1;
  if (wasAlive && target.health <= 0) {
    createWreck(state, target);
    emitEvent(state, 'kill', hitPosition, bullet.owner);
    if (bullet.owner === state.player.id) state.kills += 1;
  }
}

function updateBullets(state: GameState, dt: number): void {
  const survivors: Bullet[] = [];
  for (const bullet of state.bullets) {
    bullet.previous.copy(bullet.position);
    const travelTime = Math.min(dt, bullet.life);
    const aircraftStepFraction = dt > EPSILON ? travelTime / dt : 0;
    bullet.position.addScaledVector(bullet.velocity, travelTime);
    bullet.life = Math.max(0, bullet.life - dt);

    let target: Aircraft | null = null;
    let earliestHit: number | null = null;
    if (bullet.owner === state.player.id) {
      for (const enemy of state.enemies) {
        if (enemy.health <= 0) continue;
        const hitTime = sweptHitTime(bullet, enemy, aircraftStepFraction);
        if (hitTime !== null && (earliestHit === null || hitTime < earliestHit)) {
          target = enemy;
          earliestHit = hitTime;
        }
      }
    } else if (state.player.health > 0) {
      const hitTime = sweptHitTime(bullet, state.player, aircraftStepFraction);
      if (hitTime !== null) {
        target = state.player;
        earliestHit = hitTime;
      }
    }

    if (target && earliestHit !== null) {
      const hitPosition = bullet.previous.clone().lerp(bullet.position, earliestHit);
      damageAircraft(state, target, bullet, hitPosition);
      continue;
    }
    if (bullet.life > 0) survivors.push(bullet);
  }

  state.bullets = survivors;
  state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
}

function updatePlayerLoop(
  state: GameState,
  meta: SimulationMeta,
  input: FlightInput,
  loopPressed: boolean,
  dt: number,
  preferredSpeed: number,
  speedCeiling: number,
  responseMultiplier: number,
): boolean {
  const player = state.player;
  if (player.loopCooldown > 0) player.loopCooldown = Math.max(0, player.loopCooldown - dt);

  if (player.loopProgress <= 0 && loopPressed && player.loopCooldown <= EPSILON && player.speed >= LOOP_MIN_SPEED) {
    player.loopProgress = EPSILON;
    meta.playerLoopActive = true;
    meta.loopStartYaw = player.yaw;
    meta.loopStartPitch = player.pitch;
  }

  if (player.loopProgress <= 0) {
    updateAircraftMotion(
      player,
      input.turn,
      input.climb,
      dt,
      preferredSpeed,
      false,
      speedCeiling,
      PLAYER_MAX_PITCH,
      responseMultiplier,
    );
    return false;
  }

  if (!meta.playerLoopActive) {
    meta.playerLoopActive = true;
    meta.loopStartYaw = player.yaw;
    meta.loopStartPitch = player.pitch;
  }

  const progress = clamp(player.loopProgress + dt / LOOP_DURATION, 0, 1);
  player.loopProgress = progress;
  player.yaw = meta.loopStartYaw;
  player.pitch = meta.loopStartPitch + progress * Math.PI * 2;
  const completed = progress >= 1 - EPSILON;
  if (completed) {
    player.yaw = meta.loopStartYaw;
    player.pitch = meta.loopStartPitch;
    player.loopProgress = 0;
    player.loopCooldown = LOOP_COOLDOWN;
    meta.playerLoopActive = false;
  }
  updateAircraftMotion(player, 0, 0, dt, preferredSpeed, true, speedCeiling, PLAYER_MAX_PITCH, responseMultiplier);
  return completed;
}

function damageSpeedFactor(health: number): number {
  if (health <= 30) return 0.65;
  if (health <= 50) return 0.8;
  if (health <= 70) return 0.9;
  return 1;
}

function registerLoopReactionDelay(state: GameState, meta: SimulationMeta, playerPosition: Vector3): void {
  const playerForward = forwardOf(state.player);
  for (const enemy of state.enemies) {
    if (enemy.mode !== 'pursue' || enemy.mg <= 0 && enemy.cannon <= 0) continue;
    const fromPlayer = enemy.position.clone().sub(playerPosition);
    const distance = fromPlayer.length();
    if (distance < 100 || distance > 650 || distance < EPSILON) continue;
    const awayDirection = fromPlayer.multiplyScalar(1 / distance);
    if (playerForward.dot(awayDirection) > -0.65) continue;
    const towardPlayer = playerPosition.clone().sub(enemy.position).normalize();
    if (forwardOf(enemy).dot(towardPlayer) < 0.65) continue;
    meta.loopReactionDelay.set(enemy.id, {
      remaining: LOOP_REACTION_DELAY,
      target: playerPosition.clone(),
    });
  }
}

export function createGame(seed = 0x6d2b79f5, mode: GameMode = 'normal'): GameState {
  const normalized = normalizedSeed(seed);
  const state: GameState = {
    phase: 'ready',
    mode,
    player: makeAircraft(1, new Vector3(0, 2400, 0)),
    enemies: [makeAircraft(2, new Vector3(0, 2415, -220))],
    wrecks: [],
    bullets: [],
    events: [],
    elapsed: 0,
    kills: 0,
    shots: 0,
    hits: 0,
    loops: 0,
    damageTaken: 0,
    score: 0,
    endReason: null,
    seed: normalized,
  };
  metadata.set(state, {
    nextEntityId: 3,
    nextEventId: 1,
    randomState: normalized,
    nextSpawnAt: SPAWN_INTERVAL,
    replacementSpawnAt: null,
    playerTargetSpeed: CRUISE_SPEED,
    loopHeld: false,
    playerLoopActive: false,
    loopStartYaw: 0,
    loopStartPitch: 0,
    loopReactionDelay: new Map(),
    wreckedAircraftIds: new Set(),
  });
  return state;
}

export function startGame(state: GameState): void {
  if (state.phase === 'ready') state.phase = 'playing';
}

export function pauseGame(state: GameState): void {
  if (state.phase === 'playing') state.phase = 'paused';
}

export function resumeGame(state: GameState): void {
  if (state.phase === 'paused') state.phase = 'playing';
}

export function calculateScore(kills: number, shots: number, loops: number, damageTaken = 0): number {
  const safeKills = Math.max(0, Math.floor(Number.isFinite(kills) ? kills : 0));
  const safeShots = Math.max(0, Number.isFinite(shots) ? shots : 0);
  const safeLoops = Math.max(0, Math.floor(Number.isFinite(loops) ? loops : 0));
  const safeDamage = Math.max(0, Number.isFinite(damageTaken) ? damageTaken : 0);
  const efficiency = Math.max(0, 1 - safeShots / TOTAL_AMMO);
  const gross = safeKills * 1000 + Math.floor(safeKills * 1000 * efficiency) + safeLoops * 150;
  return Math.max(0, gross - safeDamage * 10);
}

export function stepGame(state: GameState, input: FlightInput, dt: number): void {
  state.events.length = 0;
  const meta = getMeta(state);
  if (!Number.isFinite(dt) || dt <= 0) {
    meta.loopHeld = input.loop;
    return;
  }
  if (state.phase === 'ended') {
    meta.loopHeld = input.loop;
    updateWrecks(state, Math.min(dt, ENDED_WRECK_MAX_DT));
    return;
  }
  if (state.phase !== 'playing') {
    meta.loopHeld = input.loop;
    return;
  }
  if (state.player.health <= 0) {
    finishGame(state, 'shot-down');
    return;
  }
  updateWrecks(state, dt);

  const loopPressed = input.loop && !meta.loopHeld;
  meta.loopHeld = input.loop;

  const playerStartPosition = state.player.position.clone();
  const playerStartForward = forwardOf(state.player);
  state.player.previous.copy(state.player.position);
  state.player.age += dt;
  const wasLooping = state.player.loopProgress > 0;
  const flightAssist = getFlightAssist(state.player, state.enemies, input, state.mode);
  const playerInput: FlightInput = { ...input, turn: flightAssist.turn, climb: flightAssist.climb };
  const throttleDirection = state.mode === 'easy'
    ? 0
    : Number(Boolean(input.accelerate)) - Number(Boolean(input.brake));
  meta.playerTargetSpeed = clamp(
    meta.playerTargetSpeed + throttleDirection * THROTTLE_ADJUST_RATE * dt,
    STALL_SPEED,
    MAX_SPEED,
  );
  const playerPreferredSpeed = meta.playerTargetSpeed;
  const loopCompleted = updatePlayerLoop(
    state,
    meta,
    playerInput,
    loopPressed,
    dt,
    playerPreferredSpeed,
    MAX_SPEED,
    flightAssist.responseMultiplier,
  );
  if (!wasLooping && state.player.loopProgress > 0) {
    registerLoopReactionDelay(state, meta, playerStartPosition);
  }

  const enemyFireTargets = new Map<number, Vector3>();
  for (const enemy of state.enemies) {
    enemy.previous.copy(enemy.position);
    enemy.age += dt;
    if (enemy.loopCooldown > 0) enemy.loopCooldown = Math.max(0, enemy.loopCooldown - dt);
    let reaction = meta.loopReactionDelay.get(enemy.id);
    if (enemy.mg <= 0 && enemy.cannon <= 0) {
      enemy.mode = 'flee';
      meta.loopReactionDelay.delete(enemy.id);
      reaction = undefined;
    } else if (enemy.health <= 40) {
      enemy.mode = 'evade';
      meta.loopReactionDelay.delete(enemy.id);
      reaction = undefined;
    } else if (!reaction || reaction.remaining <= 0) {
      meta.loopReactionDelay.delete(enemy.id);
      reaction = undefined;
      updateEnemyMode(enemy, playerStartPosition, playerStartForward);
    }

    if (reaction && reaction.remaining > 0 && enemy.mode === 'pursue') {
      meta.loopReactionDelay.set(enemy.id, { ...reaction, remaining: Math.max(0, reaction.remaining - dt) });
      enemyFireTargets.set(enemy.id, reaction.target);
      updateAircraftMotion(enemy, 0, 0, dt, CRUISE_SPEED * damageSpeedFactor(enemy.health));
    } else if (enemy.id === 2 && enemy.age <= INITIAL_RUN_IN && enemy.mode === 'pursue') {
      enemyFireTargets.set(enemy.id, playerStartPosition);
      updateAircraftMotion(enemy, 0, 0, dt, CRUISE_SPEED * damageSpeedFactor(enemy.health));
    } else {
      const target = enemyTarget(enemy, playerStartPosition, playerStartForward);
      const controls = desiredFlightInput(enemy, target);
      const preferredSpeed = enemy.mode === 'flee'
        ? ENEMY_FLEE_SPEED
        : enemy.mode === 'evade'
          ? ENEMY_EVADE_SPEED
          : ENEMY_PURSUIT_SPEED;
      enemyFireTargets.set(enemy.id, playerStartPosition);
      updateAircraftMotion(
        enemy,
        controls.turn,
        controls.climb,
        dt,
        preferredSpeed * damageSpeedFactor(enemy.health),
      );
    }
  }

  state.elapsed = state.mode === 'easy'
    ? Math.min(DURATION, state.elapsed + dt)
    : state.elapsed + dt;

  const playerFiring = state.mode === 'easy'
    ? shouldAutoFire(state.player, state.enemies, state.mode, input.viewAspect)
    : input.fire;
  fireWeapons(state, state.player, playerFiring, dt);
  for (const enemy of state.enemies) {
    fireWeapons(state, enemy, enemyCanFire(enemy, enemyFireTargets.get(enemy.id) ?? playerStartPosition), dt);
    if (enemy.mg <= 0 && enemy.cannon <= 0) enemy.mode = 'flee';
  }

  const killsBeforeStep = state.kills;
  updateBullets(state, dt);
  const lastLivingEnemyKilled = state.kills > killsBeforeStep && state.enemies.length === 0;
  advanceSpawnClock(state, lastLivingEnemyKilled);
  state.score = calculateScore(state.kills, state.shots, state.loops, state.damageTaken);

  // A fatal hit wins simultaneous outcomes, then the timer, then an empty
  // ammo state. Player-owned rounds already in flight resolve before ammo end.
  if (state.player.health <= 0) {
    finishGame(state, 'shot-down');
  } else if (state.mode === 'easy' && state.elapsed >= DURATION) {
    finishGame(state, 'time');
  } else if (state.mode === 'normal') {
    const playerBulletsInFlight = state.bullets.some((bullet) => bullet.owner === state.player.id);
    if (state.player.mg <= 0 && state.player.cannon <= 0 && !playerBulletsInFlight) {
      finishGame(state, 'ammo');
    } else if (loopCompleted) {
      state.loops += 1;
      state.score = calculateScore(state.kills, state.shots, state.loops, state.damageTaken);
      emitEvent(state, 'loop', state.player.position, state.player.id);
    }
  } else if (loopCompleted) {
    state.loops += 1;
    state.score = calculateScore(state.kills, state.shots, state.loops, state.damageTaken);
    emitEvent(state, 'loop', state.player.position, state.player.id);
  }
}
