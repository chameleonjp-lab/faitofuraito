import type { Aircraft, FlightInput, GameMode } from './types';
import { EASY_AIM_RADIUS, FLIGHT_FOV, projectFlightTarget } from './flight-view';

export const PLAYER_MAX_PITCH = 0.95;
export const EASY_AUTO_FIRE_RANGE = 1200;
export const OFFSCREEN_RESPONSE_MULTIPLIER = 1.65;

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

function closestVisibleTarget(player: Aircraft, enemies: readonly Aircraft[], aspect: number, mode: GameMode) {
  let closest: { enemy: Aircraft; projection: ReturnType<typeof projectFlightTarget> } | null = null;
  for (const enemy of enemies) {
    if (enemy.health <= 0) continue;
    const projection = projectFlightTarget(player, enemy.position, aspect, mode);
    if (!projection.visible) continue;
    if (!closest || projection.distance < closest.projection.distance) closest = { enemy, projection };
  }
  return closest;
}

/**
 * Adds an easy-mode steering pull toward visible enemies outside the firing
 * circle. The returned climb is still an absolute pitch command, matching the
 * aircraft controller's existing input contract.
 */
export function getFlightAssist(
  player: Aircraft,
  enemies: readonly Aircraft[],
  input: FlightInput,
  mode: GameMode,
): FlightAssistResult {
  const manualTurn = clamp(input.turn, -1, 1);
  const manualClimb = clamp(input.climb, -1, 1);
  const aspect = normalizedAspect(input.viewAspect);
  const target = closestVisibleTarget(player, enemies, aspect, mode);
  const hasVisibleTarget = target !== null;
  const responseMultiplier = enemies.some((enemy) => enemy.health > 0) && !hasVisibleTarget
    ? OFFSCREEN_RESPONSE_MULTIPLIER
    : 1;

  if (mode !== 'easy') {
    return { turn: manualTurn, climb: manualClimb, responseMultiplier, hasVisibleTarget };
  }

  if (!target) {
    return {
      turn: manualTurn,
      climb: manualClimb,
      responseMultiplier,
      hasVisibleTarget: false,
    };
  }

  const { projection } = target;
  const shortEdgeX = projection.x * Math.max(1, aspect);
  const shortEdgeY = projection.y * Math.max(1, 1 / aspect);
  const screenRadius = Math.hypot(shortEdgeX, shortEdgeY) / 2;
  const assistFade = clamp((screenRadius - EASY_AIM_RADIUS) / (EASY_AIM_RADIUS * 2), 0, 1);
  if (assistFade <= 0) {
    return { turn: manualTurn, climb: manualClimb, responseMultiplier, hasVisibleTarget: true };
  }

  const tanVerticalHalf = Math.tan((FLIGHT_FOV * Math.PI) / 360);
  const horizontalHalfFov = Math.atan(aspect * tanVerticalHalf);
  const screenHorizontal = projection.x * Math.tan(horizontalHalfFov);
  const screenVertical = projection.y * tanVerticalHalf;
  const bankCos = Math.cos(player.bank);
  const bankSin = Math.sin(player.bank);
  const viewYaw = Math.atan(screenHorizontal * bankCos + screenVertical * bankSin);
  const viewPitch = Math.atan(-screenHorizontal * bankSin + screenVertical * bankCos);
  const requestedTurn = clamp(viewYaw / 0.18, -1, 1) * assistFade;
  // Stick input opposes a screen-space correction only when it asks for a
  // different direction. In that case the pilot's requested turn wins intact.
  const turnOpposes = manualTurn * requestedTurn < 0;
  const turn = turnOpposes ? manualTurn : clamp(manualTurn + requestedTurn, -1, 1);

  const manualAbsolutePitch = manualClimb * PLAYER_MAX_PITCH;
  const assistedAbsolutePitch = player.pitch + viewPitch;
  const pitchOpposes = Math.abs(manualClimb) > 0.05 && manualClimb * viewPitch < 0;
  const absolutePitch = pitchOpposes
    ? manualAbsolutePitch
    : manualAbsolutePitch + (assistedAbsolutePitch - manualAbsolutePitch) * assistFade;

  return {
    turn,
    climb: clamp(absolutePitch / PLAYER_MAX_PITCH, -1, 1),
    responseMultiplier,
    hasVisibleTarget: true,
  };
}

/** Re-checks the live world immediately before firing; it does not use render state. */
export function shouldAutoFire(
  player: Aircraft,
  enemies: readonly Aircraft[],
  mode: GameMode,
  aspect: number | undefined,
): boolean {
  if (mode !== 'easy') return false;
  const safeAspect = normalizedAspect(aspect);
  return enemies.some((enemy) => {
    if (enemy.health <= 0) return false;
    const projection = projectFlightTarget(player, enemy.position, safeAspect, mode);
    return projection.visible
      && projection.inCircle
      && projection.distance <= EASY_AUTO_FIRE_RANGE;
  });
}
