import { flightTargetKey, selectProjectedTarget, type FlightTargetLock } from './flight-target';
import type { Aircraft, FlightInput, GameMode } from './types';
import { Vector3 } from 'three';
import { projectFlightTarget } from './flight-view';

export const PLAYER_MAX_PITCH = 0.95;
export const EASY_AUTO_FIRE_RANGE = 1200;
// Legacy NPC launch prediction. Player weapon construction never calls this path.
export const NPC_SHOT_ASSIST_FRACTION = 0.35;
export const NPC_SHOT_ASSIST_MAX_ANGLE = 0.028;

export interface FlightAssistResult {
  turn: number;
  climb: number;
  responseMultiplier: number;
  hasVisibleTarget: boolean;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function normalizedAspect(aspect: number | undefined): number {
  return Number.isFinite(aspect) && (aspect ?? 0) > 0 ? aspect! : 393 / 852;
}

/** Manual steering never inspects enemies or retains a selected target. */
export function getFlightAssist(_player: Aircraft, _enemies: readonly Aircraft[], input: FlightInput,
  _mode: GameMode, _lock?: FlightTargetLock): FlightAssistResult {
  return { turn: clamp(input.turn, -1, 1), climb: clamp(input.climb, -1, 1), responseMultiplier: 1, hasVisibleTarget: false };
}

/** Re-checks the live world immediately before firing; it does not use render state. */
export function shouldAutoFire(
  player: Aircraft,
  enemies: readonly Aircraft[],
  mode: GameMode,
  aspect: number | undefined,
): boolean {
  return autoFireTarget(player, enemies, mode, aspect) !== null;
}

export function autoFireTarget(player: Aircraft, enemies: readonly Aircraft[], mode: GameMode, aspect: number | undefined, lock?: FlightTargetLock): Aircraft | null {
  if (mode !== 'easy') return null;
  const safeAspect = normalizedAspect(aspect);
  const candidates = enemies.filter(enemy => enemy.health > 0 && (!('team' in enemy) || enemy.team === 'enemy')).map(enemy => ({
    enemy, key: flightTargetKey(enemy), projection: projectFlightTarget(player, enemy.position, safeAspect, mode),
  })).filter(candidate => candidate.projection.inCircle && candidate.projection.distance <= EASY_AUTO_FIRE_RANGE);
  return selectProjectedTarget(candidates, safeAspect, EASY_AUTO_FIRE_RANGE, lock)?.enemy ?? null;
}

/** NPC straight-flight prediction; maneuvers after launch can still evade the shot. */
export function predictedShotDirection(origin: Vector3, forward: Vector3, target: Aircraft, bulletSpeed: number, lifetime: number): Vector3 {
  const velocity = new Vector3(0, 0, -1).applyQuaternion(target.quaternion).multiplyScalar(target.speed);
  const relative = target.position.clone().sub(origin);
  const a = velocity.lengthSq() - bulletSpeed * bulletSpeed;
  const b = 2 * relative.dot(velocity);
  const c = relative.lengthSq();
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0 || Math.abs(a) < 1e-8) return forward.clone();
  const root = Math.sqrt(discriminant);
  const times = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(t => t > 0 && t <= lifetime);
  if (!times.length) return forward.clone();
  const direction = relative.addScaledVector(velocity, Math.min(...times)).normalize();
  const angle = forward.angleTo(direction);
  if (angle > 0.16 || angle < 1e-8) return forward.clone();
  const correction = Math.min(angle * NPC_SHOT_ASSIST_FRACTION, NPC_SHOT_ASSIST_MAX_ANGLE);
  // Spherical interpolation preserves the exact angular cap and unit length.
  return forward.clone().multiplyScalar(Math.sin(angle - correction) / Math.sin(angle))
    .addScaledVector(direction, Math.sin(correction) / Math.sin(angle)).normalize();
}
