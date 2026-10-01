import type { Aircraft, GameState } from './types';
import { FLIGHT_FOV, FLIGHT_VISIBILITY_RANGE, projectFlightTarget } from './flight-view';

export const RADAR_RANGE = FLIGHT_VISIBILITY_RANGE;

/** Heading-up horizontal map. Pitch/roll and altitude never displace the bearing. */
export function radarContacts(player: Aircraft, enemies: Aircraft[], mode: GameState['mode'] = 'normal', aspect = 393 / 852) {
  const cos = Math.cos(player.yaw), sin = Math.sin(player.yaw);
  return enemies.filter(enemy => enemy.health > 0).map(enemy => {
    const dx = enemy.position.x - player.position.x, dz = enemy.position.z - player.position.z;
    const height = enemy.position.y - player.position.y;
    const right = cos * dx - sin * dz, back = sin * dx + cos * dz;
    const horizontal = Math.hypot(right, back), distance = Math.hypot(horizontal, height);
    const outside = distance > RADAR_RANGE;
    const scale = outside ? Math.max(horizontal, 1e-8) : RADAR_RANGE;
    return { id: enemy.id, x: right / scale, y: outside && horizontal < 1e-8 ? -Math.sign(height) : back / scale, height,
      distance, outside, visible: projectFlightTarget(player, enemy.position, aspect, mode).visible,
      empty: enemy.mg + enemy.cannon === 0 };
  }).sort((a, b) => b.distance - a.distance);
}

export class SphereRadar {
  private ctx: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement) { this.ctx = canvas.getContext('2d')!; }
  draw(state: GameState) {
    const c = this.ctx, dpr = Math.min(window.devicePixelRatio || 1, 2), size = this.canvas.clientWidth;
    if (this.canvas.width !== Math.round(size * dpr)) {
      this.canvas.width = Math.round(size * dpr); this.canvas.height = Math.round(size * dpr);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, size, size);
    const r = size * .40, cx = size / 2, cy = size * .50;
    const bg = c.createRadialGradient(cx - r * .3, cy - r * .4, 0, cx, cy, r);
    bg.addColorStop(0, 'rgba(48,84,94,.58)'); bg.addColorStop(1, 'rgba(5,20,29,.84)');
    c.fillStyle = bg; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.lineWidth = 1;
    for (const fraction of [1 / 3, 2 / 3, 1]) {
      c.strokeStyle = fraction === 1 ? 'rgba(172,216,222,.5)' : 'rgba(172,216,222,.22)';
      c.beginPath(); c.arc(cx, cy, r * fraction, 0, Math.PI * 2); c.stroke();
    }
    c.strokeStyle = 'rgba(172,216,222,.18)'; c.beginPath();
    c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r); c.stroke();
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const halfFov = Math.atan(Math.tan(FLIGHT_FOV * Math.PI / 360) * aspect);
    c.fillStyle = 'rgba(171,225,217,.07)'; c.beginPath(); c.moveTo(cx, cy);
    c.arc(cx, cy, r, -Math.PI / 2 - halfFov, -Math.PI / 2 + halfFov); c.closePath(); c.fill();
    const contacts = radarContacts(state.player, state.enemies, state.mode, aspect);
    for (const contact of contacts) {
      const x = cx + contact.x * r, y = cy + contact.y * r;
      c.strokeStyle = contact.outside ? '#889b9d' : contact.visible ? '#ffe09b' : '#ffc387'; c.fillStyle = c.strokeStyle;
      c.lineWidth = 1.25;
      if (contact.outside) {
        c.save(); c.translate(x, y); c.rotate(Math.atan2(contact.y, contact.x) + Math.PI / 2);
        c.beginPath(); c.moveTo(0, -3); c.lineTo(3.5, 4); c.lineTo(-3.5, 4); c.closePath(); c.stroke(); c.restore();
      } else {
        c.beginPath(); c.moveTo(x, y - 3.2); c.lineTo(x + 3.2, y); c.lineTo(x, y + 3.2); c.lineTo(x - 3.2, y); c.closePath();
        contact.empty || !contact.visible ? c.stroke() : c.fill();
      }
      if (Math.abs(contact.height) > 40) {
        const direction = contact.height > 0 ? -1 : 1;
        c.beginPath(); c.moveTo(x + 5, y - direction); c.lineTo(x + 7, y + direction * 2); c.lineTo(x + 9, y - direction); c.stroke();
      }
    }
    c.fillStyle = '#e2fffc'; c.beginPath(); c.moveTo(cx, cy - 4); c.lineTo(cx + 3, cy + 3);
    c.lineTo(cx, cy + 1); c.lineTo(cx - 3, cy + 3); c.closePath(); c.fill();
    c.font = '10px sans-serif'; c.textAlign = 'center'; c.fillStyle = '#c9dedc';
    c.fillText('前', cx, cy - r - 4); c.fillText('後', cx, cy + r + 12);
    const rangeLabel = document.getElementById('radar-range');
    if (rangeLabel) rangeLabel.textContent = '範囲1.5km';
    const nearestLabel = document.getElementById('radar-nearest'), nearest = contacts.at(-1);
    if (nearestLabel) nearestLabel.textContent = nearest
      ? `最寄 ${nearest.distance >= 1000 ? `${(nearest.distance / 1000).toFixed(1)}km` : `${Math.round(nearest.distance)}m`}・${nearest.outside ? '範囲外' : nearest.visible ? '画面内' : '画面外'}・${Math.abs(nearest.height) <= 40 ? '同高度' : `${nearest.height > 0 ? '上' : '下'}${Math.round(Math.abs(nearest.height))}m`}`
      : '敵機なし';
    this.canvas.setAttribute('aria-label', `レーダー。前が上、視認範囲1.5km、目盛り500m。敵${contacts.length}機。画面内は塗りつぶし、画面外は中抜き、範囲外は外周の三角。上下の印は高度差。`);
  }
}
