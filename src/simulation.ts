import { aircraftWreckPose } from './aircraft-vfx';
import { CRUISE_SPEED, MAX_SPEED, STALL_SPEED, clamp, normalizeAngle, updateQuaternion, forwardOf, updateAircraftMotion, desiredFlightInput, updatePlayerLoop, advanceThrottle } from './flight';
export { CRUISE_SPEED, MAX_SPEED, STALL_SPEED } from './flight';
import { aircraftDamageMultiplier, AIRCRAFT_HEALTH, AIRCRAFT_BASE_DAMAGE } from './aircraft-damage';
import { Quaternion, Vector3 } from 'three';
import { autoFireTarget, getFlightAssist, PLAYER_MAX_PITCH, predictedShotDirection } from './flight-assist';
import type { Aircraft, Bullet, FlightInput, GameEvent, GameMode, GameState, Wreck } from './types';

export const DURATION = 300;
export const LOW_ALTITUDE_LIMIT = 1200;
export const LOW_ALTITUDE_GRACE_SECONDS = 10;
export const MG_AMMO = 288;
export const CANNON_AMMO = 96;
export const TOTAL_AMMO = MG_AMMO + CANNON_AMMO;
export const SCORE_AMMO_REFERENCE = 1120;




export const MAX_ACTIVE_ENEMIES = 5;

const INITIAL_HEALTH = AIRCRAFT_HEALTH;
export const PLAYER_RELOAD_TICKS = 6 * 60;
const MAX_BULLETS = 2048;
const SPAWN_INTERVAL = 14;
const WRECK_LIFETIME = 5;
export const BULLET_LIFETIME = 1.5;
const MG_RATE = 12;
const CANNON_RATE = 4;
const MG_MUZZLE_SPEED = 820;
const CANNON_MUZZLE_SPEED = 700;
const EPSILON = 1e-8;
const ENDED_WRECK_MAX_DT = 1 / 30;

const LOCAL_HIT_SPHERES = [
  { center: new Vector3(0, 0, -3.8), radius: 3.0 },
  { center: new Vector3(0, 0, 0), radius: 4.6 },
  { center: new Vector3(0, 0, 3.4), radius: 2.7 },
  { center: new Vector3(4.0, 0, 0.25), radius: 2.1 },
  { center: new Vector3(-4.0, 0, 0.25), radius: 2.1 },
];
const CONTACT_BOUNDING_RADIUS = 2 * Math.max(...LOCAL_HIT_SPHERES.map(sphere => sphere.center.length() + sphere.radius));

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
  loopStartSteeringRevision: number | undefined;
  loopStartTurn: number;
  loopStartClimb: number;
  wreckedAircraftIds: Set<number>;
  assistTurn: number;
  assistClimb: number;
  responseMultiplier: number;
}

const metadata = new WeakMap<GameState, SimulationMeta>();
const wreckOrigins = new WeakMap<Wreck, { position: Vector3; quaternion: Quaternion }>();

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
      loopStartSteeringRevision: undefined,
      loopStartTurn: 0,
      loopStartClimb: 0,
      wreckedAircraftIds: new Set(),
      assistTurn: 0, assistClimb: 0, responseMultiplier: 1,
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
    maxHealth: INITIAL_HEALTH,
    reloadTicksRemaining: 0,
    mg: MG_AMMO,
    cannon: CANNON_AMMO,
    fireClock: 0,
    cannonClock: 0,
    loopProgress: 0,
    loopCooldown: 0,
    mode: 'pursue',
    age: 0, aiPhase: 'approach', aiPhaseTime: 0, aiWaypoint: position.clone(), aiTurn: 0, aiClimb: 0, aiFire: false,
  };
  updateQuaternion(aircraft);
  return aircraft;
}

function emitEvent(
  state: GameState,
  type: GameEvent['type'],
  position: Vector3,
  owner: number,
  target?: number,
): void {
  const meta = getMeta(state);
  state.events.push({
    id: meta.nextEventId++,
    type,
    position: position.clone(),
    owner, target,
  });
}

function createWreck(state: GameState, aircraft: Aircraft): void {
  const meta = getMeta(state);
  if (meta.wreckedAircraftIds.has(aircraft.id)) return;
  meta.wreckedAircraftIds.add(aircraft.id);

  const velocity = forwardOf(aircraft).multiplyScalar(aircraft.speed * 0.5);
  const wreck: Wreck = {
    id: meta.nextEntityId++,
    sourceId: aircraft.id, player: aircraft.id === state.player.id, speed: aircraft.speed,
    position: aircraft.position.clone(),
    previous: aircraft.position.clone(),
    quaternion: aircraft.quaternion.clone(),
    velocity,
    age: 0,
  };
  wreckOrigins.set(wreck, { position: wreck.position.clone(), quaternion: wreck.quaternion.clone() });
  state.wrecks.push(wreck);
}

function updateWrecks(state: GameState, dt: number): void {
  const survivors: Wreck[] = [];
  for (const wreck of state.wrecks) {
    wreck.previous.copy(wreck.position);
    const origin = wreckOrigins.get(wreck) ?? { position: wreck.position.clone(), quaternion: wreck.quaternion.clone() };
    wreck.age += dt;
    const pose = aircraftWreckPose(origin.position, origin.quaternion, wreck.velocity, wreck.age);
    wreck.position.copy(pose.position); wreck.quaternion.copy(pose.quaternion);
    if (wreck.age < WRECK_LIFETIME - EPSILON) survivors.push(wreck);
    else wreckOrigins.delete(wreck);
  }
  state.wrecks = survivors;
}

function finishGame(state: GameState, reason: NonNullable<GameState['endReason']>): void {
  if (state.phase === 'ended') return;
  if (reason === 'shot-down' || reason === 'collision') {
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
  autoTarget: Aircraft | null = null,
): Bullet {
  const meta = getMeta(state);
  const forward = forwardOf(shooter);
  const muzzleSpeed = kind === 'mg' ? MG_MUZZLE_SPEED : CANNON_MUZZLE_SPEED;
  const damage = AIRCRAFT_BASE_DAMAGE[shooter.id === state.player.id ? 'player' : 'enemy'][kind];
  const gunSide = gunIndex === 0 ? -1 : 1;
  const gunOffset = kind === 'mg'
    ? new Vector3(gunSide * 0.3, 0.52, -4.25)
    : new Vector3(gunSide * 2.5, 0, -2.4);
  const position = shooter.position.clone().add(gunOffset.applyQuaternion(shooter.quaternion));
  const bulletSpeed = shooter.speed + muzzleSpeed;
  const direction = autoTarget ? predictedShotDirection(position, forward, autoTarget, bulletSpeed, BULLET_LIFETIME) : forward;
  if (shooter.id !== state.player.id) {
    const tick = Math.round(state.elapsed * 60);
    direction.x += Math.sin(tick * 1.7 + shooter.id * 3 + gunSide) * 0.022;
    direction.y += Math.cos(tick * 1.3 + shooter.id * 2 + gunSide) * 0.022;
    direction.normalize();
  }
  return {
    id: meta.nextEntityId++,
    owner: shooter.id,
    position,
    previous: position.clone(),
    velocity: direction.multiplyScalar(bulletSpeed),
    life: BULLET_LIFETIME,
    distanceTravelled: 0,
    damage,
    kind,
  };
}

function fireWeapons(state: GameState, aircraft: Aircraft, firing: boolean, dt: number, autoTarget: Aircraft | null = null): void {
  aircraft.fireClock = Math.max(0, aircraft.fireClock - dt);
  aircraft.cannonClock = Math.max(0, aircraft.cannonClock - dt);
  const player = aircraft.id === state.player.id;
  if (!firing || aircraft.health <= 0 || (player && aircraft.reloadTicksRemaining > 0)) return;
  for (const kind of ['mg', 'cannon'] as const) {
    const clock = kind === 'mg' ? 'fireClock' : 'cannonClock';
    if (aircraft[clock] > EPSILON || (player && aircraft[kind] < 2) || state.bullets.length + 2 > MAX_BULLETS) continue;
    for (let side = 0; side < 2; side++) {
      const bullet = createBullet(state, aircraft, kind, side, autoTarget);
      state.bullets.push(bullet);
      if (player) state.shots += 1;
      emitEvent(state, 'shot', bullet.position, aircraft.id);
    }
    if (player) aircraft[kind] -= 2;
    aircraft[clock] = player ? (kind === 'mg' ? 1 / MG_RATE : 1 / CANNON_RATE) : (kind === 'mg' ? 0.28 : 0.95);
  }
  if (player && aircraft.mg <= 0 && aircraft.cannon <= 0 && aircraft.reloadTicksRemaining <= 0) {
    aircraft.reloadTicksRemaining = PLAYER_RELOAD_TICKS;
    emitEvent(state, 'reload-start', aircraft.position, aircraft.id);
  }
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

/** Sweep both aircraft shapes so fast crossing paths cannot pass through. */
function aircraftContactTime(player: Aircraft, enemy: Aircraft): number | null {
  if (segmentSphereEntry(player.previous.clone().sub(enemy.previous), player.position.clone().sub(enemy.position), CONTACT_BOUNDING_RADIUS) === null) return null;
  let first: number | null = null;
  for (const p of LOCAL_HIT_SPHERES) for (const e of LOCAL_HIT_SPHERES) {
    const pOffset = p.center.clone().applyQuaternion(player.quaternion);
    const eOffset = e.center.clone().applyQuaternion(enemy.quaternion);
    const start = player.previous.clone().add(pOffset).sub(enemy.previous).sub(eOffset);
    const end = player.position.clone().add(pOffset).sub(enemy.position).sub(eOffset);
    const time = segmentSphereEntry(start, end, p.radius + e.radius);
    if (time !== null && (first === null || time < first)) first = time;
  }
  return first;
}

function resolveAircraftCollision(state: GameState): boolean {
  let contact: Aircraft | null = null;
  let first = Infinity;
  for (const enemy of state.enemies) {
    if (enemy.health <= 0) continue;
    const time = aircraftContactTime(state.player, enemy);
    if (time !== null && time < first) { contact = enemy; first = time; }
  }
  if (!contact) return false;
  state.player.position.lerpVectors(state.player.previous, state.player.position, first);
  contact.position.lerpVectors(contact.previous, contact.position, first);
  contact.health = state.player.health = 0;
  state.kills += 1;
  // Kaisen counts aircraft destruction normally; no separate ram reward.
  state.contactKills = 0;
  createWreck(state, contact);
  emitEvent(state, 'kill', contact.position, state.player.id, contact.id);
  emitEvent(state, 'kill', state.player.position, contact.id, state.player.id);
  state.score = calculateScore(state.kills, state.shots, state.loops, state.damageTaken, state.contactKills);
  finishGame(state, 'collision');
  return true;
}

function damageAircraft(
  state: GameState,
  target: Aircraft,
  bullet: Bullet,
  hitPosition: Vector3,
): void {
  const wasAlive = target.health > 0;
  const previousHealth = target.health;
  target.health = Math.max(0, target.health - bullet.damage * aircraftDamageMultiplier(bullet.kind, (bullet.distanceTravelled ?? 0) + bullet.previous.distanceTo(hitPosition)));
  if (target.id === state.player.id) state.damageTaken += previousHealth - target.health;
  emitEvent(state, 'hit', hitPosition, bullet.owner, target.id);
  emitEvent(state, 'damage', hitPosition, target.id, target.id);

  if (bullet.owner === state.player.id) state.hits += 1;
  if (wasAlive && target.health <= 0) {
    createWreck(state, target);
    emitEvent(state, 'kill', hitPosition, bullet.owner, target.id);
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
    bullet.distanceTravelled = (bullet.distanceTravelled ?? 0) + bullet.previous.distanceTo(bullet.position);
    if (bullet.life > 0) survivors.push(bullet);
  }

  state.bullets = survivors;
  state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
}

/** Kaisen aircraft-only attack passes; altitude datum translated from 350m to this world's 2400m start. */
const AI_ALTITUDE_DATUM = 2050;
function updateEnemyAI(state: GameState, plane: Aircraft, dt: number): void {
  const target = state.player;
  plane.aiPhaseTime += dt;
  if (target.health <= 0) { plane.aiTurn = plane.aiClimb = 0; plane.aiFire = false; return; }
  const distance = plane.position.distanceTo(target.position);
  const mustEscape = plane.position.y < AI_ALTITUDE_DATUM + 50;
  if (plane.aiPhase !== 'extend' && (mustEscape || distance < 88)) {
    plane.aiPhase = 'extend'; plane.mode = 'evade'; plane.aiPhaseTime = 0;
    const forward = forwardOf(plane); forward.y = 0;
    if (forward.lengthSq() < .01) forward.set(0, 0, -1);
    forward.normalize();
    plane.aiWaypoint.copy(plane.position).addScaledVector(forward, 380)
      .addScaledVector(new Vector3(-forward.z, 0, forward.x), plane.id % 2 === 0 ? 85 : -85);
    plane.aiWaypoint.y = Math.max(AI_ALTITUDE_DATUM + 160, Math.min(AI_ALTITUDE_DATUM + 650, plane.position.y + 65));
  }
  if (plane.aiPhase === 'extend' && plane.aiPhaseTime >= 3.4) {
    plane.aiPhase = 'approach'; plane.aiPhaseTime = 0; plane.mode = 'pursue';
  }
  const tick = Math.round((state.elapsed + dt) * 60);
  if (tick % 6 === plane.id % 6 || plane.aiPhaseTime <= dt + EPSILON || mustEscape) {
    let aim: Vector3;
    if (plane.aiPhase === 'extend') {
      aim = plane.aiWaypoint.clone();
      if (mustEscape) aim.y = Math.max(AI_ALTITUDE_DATUM + 210, plane.position.y + 180);
    } else {
      aim = target.position.clone().addScaledVector(forwardOf(target), target.speed * Math.min(.75, distance / 930));
      aim.y = Math.max(AI_ALTITUDE_DATUM + 110, aim.y);
      plane.aiPhase = distance < 700 ? 'attack' : 'approach';
    }
    const controls = desiredFlightInput(plane, aim);
    plane.aiTurn = controls.turn; plane.aiClimb = clamp(controls.climb, -1, 1);
  }
  plane.aiFire = plane.aiPhase !== 'extend' && distance < 740 && distance > 35
    && forwardOf(plane).angleTo(target.position.clone().sub(plane.position)) < .09 && !mustEscape;
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
    contactKills: 0,
    shots: 0,
    hits: 0,
    loops: 0,
    damageTaken: 0,
    score: 0,
    endReason: null,
    lowAltitudeRemaining: null,
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
    loopStartSteeringRevision: undefined,
    loopStartTurn: 0,
    loopStartClimb: 0,
    wreckedAircraftIds: new Set(),
    assistTurn: 0, assistClimb: 0, responseMultiplier: 1,
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

/** Integer ranking contract: floor the final score, not each fractional hit. */
export function damagePenaltyPoints(damageTaken: number): number {
  return Math.max(0, Math.ceil(Math.max(0, Number.isFinite(damageTaken) ? damageTaken : 0) * 10 - 1e-8));
}

export function calculateScore(kills: number, shots: number, loops: number, damageTaken = 0, contactKills = 0): number {
  const safeKills = Math.max(0, Math.floor(Number.isFinite(kills) ? kills : 0));
  const safeShots = Math.max(0, Number.isFinite(shots) ? shots : 0);
  const safeLoops = Math.max(0, Math.floor(Number.isFinite(loops) ? loops : 0));
  const safeDamage = Math.max(0, Number.isFinite(damageTaken) ? damageTaken : 0);
  const safeContacts = clamp(Math.floor(Number.isFinite(contactKills) ? contactKills : 0), 0, safeKills);
  const gunKills = safeKills - safeContacts;
  const efficiency = Math.max(0, 1 - safeShots / SCORE_AMMO_REFERENCE);
  const gross = gunKills * 1000 + Math.floor(gunKills * 1000 * efficiency) + safeLoops * 150;
  return Math.max(0, gross - damagePenaltyPoints(safeDamage)) + safeContacts * 1000;
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
  if (state.player.reloadTicksRemaining > 0) {
    state.player.reloadTicksRemaining = Math.max(0, state.player.reloadTicksRemaining - dt * 60);
    if (state.player.reloadTicksRemaining < EPSILON) {
      state.player.reloadTicksRemaining = 0;
      state.player.mg = MG_AMMO; state.player.cannon = CANNON_AMMO;
      emitEvent(state, 'reload-complete', state.player.position, state.player.id);
    }
  }
  updateWrecks(state, dt);
  if (state.lowAltitudeRemaining !== null) {
    state.lowAltitudeRemaining = Math.max(0, state.lowAltitudeRemaining - dt);
  }

  const loopPressed = input.loop && !meta.loopHeld;
  meta.loopHeld = input.loop;

  state.player.previous.copy(state.player.position);
  state.player.age += dt;
  const flightAssist = getFlightAssist(state.player, state.enemies, input, state.mode);
  const slew = (current: number, target: number, rate: number) => current + clamp(target - current, -rate * dt, rate * dt);
  const manualActive = Math.max(Math.abs(input.turn), Math.abs(input.climb)) >= 0.35;
  meta.assistTurn = manualActive ? 0 : slew(meta.assistTurn, flightAssist.turn - input.turn, 2.5);
  meta.assistClimb = manualActive ? 0 : slew(meta.assistClimb, flightAssist.climb - input.climb, 1.5);
  if (meta.assistTurn * input.turn < 0) meta.assistTurn = 0;
  if (meta.assistClimb * input.climb < 0) meta.assistClimb = 0;
  meta.responseMultiplier = slew(meta.responseMultiplier, flightAssist.responseMultiplier, 2.5);
  const playerInput: FlightInput = { ...input, turn: input.turn + meta.assistTurn, climb: input.climb + meta.assistClimb };
  const playerPreferredSpeed = advanceThrottle(meta, input, state.mode, dt);
  const loopCompleted = updatePlayerLoop(
    state.player,
    meta,
    playerInput,
    input,
    loopPressed,
    dt,
    playerPreferredSpeed,
    MAX_SPEED,
    meta.responseMultiplier,
  );

  if (state.lowAltitudeRemaining === null && state.player.position.y <= LOW_ALTITUDE_LIMIT) {
    state.lowAltitudeRemaining = LOW_ALTITUDE_GRACE_SECONDS;
  }

  for (const enemy of state.enemies) {
    enemy.previous.copy(enemy.position); enemy.age += dt;
    updateEnemyAI(state, enemy, dt);
    updateAircraftMotion(enemy, enemy.aiTurn, enemy.aiClimb, dt, enemy.aiPhase === 'extend' ? 118 : 112);
  }

  state.elapsed = state.mode === 'easy'
    ? Math.min(DURATION, state.elapsed + dt)
    : state.elapsed + dt;

  if (resolveAircraftCollision(state)) return;

  const autoTarget = autoFireTarget(state.player, state.enemies, state.mode, input.viewAspect);
  const playerFiring = state.mode === 'easy' ? autoTarget !== null : input.fire;
  fireWeapons(state, state.player, playerFiring, dt, autoTarget);
  for (const enemy of state.enemies) {
    fireWeapons(state, enemy, enemy.aiFire, dt, state.player);
  }

  const killsBeforeStep = state.kills;
  updateBullets(state, dt);
  const lastLivingEnemyKilled = state.kills > killsBeforeStep && state.enemies.length === 0;
  advanceSpawnClock(state, lastLivingEnemyKilled);
  state.score = calculateScore(state.kills, state.shots, state.loops, state.damageTaken);

  // A fatal hit wins simultaneous outcomes, then the low-altitude deadline,
  // mode timer, and empty ammo. Player rounds already in flight resolve first.
  if (state.player.health <= 0) {
    finishGame(state, 'shot-down');
  } else if (state.lowAltitudeRemaining !== null && state.lowAltitudeRemaining <= EPSILON) {
    finishGame(state, 'low-altitude');
  } else if (state.mode === 'easy' && state.elapsed >= DURATION) {
    finishGame(state, 'time');
  } else if (state.mode === 'normal') {
    if (loopCompleted) {
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
