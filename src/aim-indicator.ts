import type { Vector3 } from 'three';
import { projectFlightTarget } from './flight-view';
import type { GameState } from './types';

export const AIM_COLORS = { clear: '#ffffff', enemy: '#ff645b', friendly: '#6cb8ff' } as const;
/** Structural adapter: FightFlight has enemies only and does not import fleets or allies. */
export type AircraftAimTarget = { position: Vector3; health: number; team?: 'friendly' | 'enemy' };
export function aimRadius(mode: GameState['mode'], width: number, height: number): number {
  return mode === 'normal' ? Math.max(26, Math.min(38, Math.min(width, height) * .085)) : Math.min(width, height) * .135;
}

/** Display only, matching Kaisen aircraft coloring. It never changes targeting or flight. */
export function aimIndicator(state: Pick<GameState, 'player' | 'mode'>, targets: readonly AircraftAimTarget[], sight: { x: number; y: number }, width: number, height: number): keyof typeof AIM_COLORS {
  const radius = aimRadius(state.mode, width, height);
  let indicator: keyof typeof AIM_COLORS = 'clear';
  for (const target of targets) {
    if (target.health <= 0) continue;
    const p = projectFlightTarget(state.player, target.position, width / height, state.mode);
    if (p.depth <= 0 || p.distance > 1500) continue;
    if (Math.hypot((p.x * .5 + .5) * width - sight.x, (.5 - p.y * .5) * height - sight.y) > radius) continue;
    if (target.team === 'friendly') return 'friendly';
    indicator = 'enemy';
  }
  return indicator;
}

/** Kaisen aircraft diamonds, range labels and proportional health bars only. */
export function aircraftMarkers(state: Pick<GameState, 'player' | 'mode' | 'enemies'>, width: number, height: number) {
  return state.enemies.flatMap(target => {
    if (target.health <= 0) return [];
    const p = projectFlightTarget(state.player, target.position, width / height, state.mode);
    if (p.depth <= 0 || p.distance > 1500 || Math.abs(p.x) > .94 || Math.abs(p.y) > .82) return [];
    return [{
      x: (p.x * .5 + .5) * width,
      y: (.5 - p.y * .5) * height,
      distance: Math.round(p.distance),
      healthFraction: Math.max(0, Math.min(1, target.health / target.maxHealth)),
    }];
  });
}
