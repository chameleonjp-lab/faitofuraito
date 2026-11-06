import { Euler, Quaternion, Vector3 } from 'three';

/** Test pilot only. Commands still reach the game through its real pointer adapter. */
export function manualLeadCommand(player: Vector3, rotation: Quaternion, target: Vector3, velocity: Vector3) {
  const lead = target.clone().sub(player).addScaledVector(velocity, target.distanceTo(player) / 850).normalize();
  const attitude = new Euler().setFromQuaternion(rotation, 'YXZ');
  const yawError = Math.atan2(Math.sin(Math.atan2(-lead.x, -lead.z) - attitude.y),
    Math.cos(Math.atan2(-lead.x, -lead.z) - attitude.y));
  return {
    turn: Math.max(-1, Math.min(1, -yawError / .18)),
    climb: Math.max(-1, Math.min(1, (Math.asin(lead.y) - attitude.x) / .18)),
  };
}
