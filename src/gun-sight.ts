import { Vector3 } from 'three';
import { projectFlightTarget } from './flight-view';
import type { Aircraft } from './types';

/** Kaisen c63bff8 bore sight: a fixed 500 m convergence plane.
 * Enemy appearance, removal and distance must not move the manual reticle.
 */
export function projectGunSight(player: Aircraft, width: number, height: number) {
  const forward = new Vector3(0, 0, -1).applyQuaternion(player.quaternion);
  const depth = 500;
  const aim = new Vector3(0, 0, -4.5).applyQuaternion(player.quaternion)
    .add(player.position).addScaledVector(forward, depth);
  const projection = projectFlightTarget(player, aim, width / height, 'normal');
  return { x: (projection.x * .5 + .5) * width, y: (.5 - projection.y * .5) * height, depth };
}
