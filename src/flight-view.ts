import { Quaternion, Vector3 } from 'three';
import type { Aircraft, GameMode } from './types';

export const FLIGHT_FOV = 64;
export const FLIGHT_FAR = 6500;
/** Radius as a fraction of the shorter CSS viewport edge. */
export const EASY_AIM_RADIUS = 0.12;
const CAMERA_OFFSET = new Vector3(0, 11, 29);
const NORMAL_LOOK = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.19);
const EASY_LOOK = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.atan2(11, 479));
const TAN_HALF_FOV = Math.tan(FLIGHT_FOV * Math.PI / 360);

/** Shared by rendering and targeting so the displayed circle is the actual firing gate. */
export function getFlightCameraPose(player: Aircraft, mode: GameMode, position: Vector3, rotation: Quaternion): void {
  position.copy(CAMERA_OFFSET).applyQuaternion(player.quaternion).add(player.position);
  rotation.copy(player.quaternion).multiply(mode === 'easy' ? EASY_LOOK : NORMAL_LOOK);
}

export function projectFlightTarget(player: Aircraft, target: Vector3, aspect: number, mode: GameMode) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 393 / 852;
  const position = new Vector3(), rotation = new Quaternion();
  getFlightCameraPose(player, mode, position, rotation);
  const local = target.clone().sub(position).applyQuaternion(rotation.invert());
  const depth = -local.z, divisor = Math.max(0.0001, Math.abs(depth));
  const x = local.x / (divisor * TAN_HALF_FOV * safeAspect);
  const y = local.y / (divisor * TAN_HALF_FOV);
  const visible = depth > 0.1 && depth < FLIGHT_FAR && Math.abs(x) <= 1 && Math.abs(y) <= 1;
  const radial = Math.hypot(x * Math.max(1, safeAspect), y * Math.max(1, 1 / safeAspect)) / 2;
  return { x, y, depth, distance: player.position.distanceTo(target), visible, inCircle: visible && radial <= EASY_AIM_RADIUS };
}
