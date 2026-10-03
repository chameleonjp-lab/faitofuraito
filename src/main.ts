import './style.css';
import { FlightScene } from './scene';
import { SphereRadar } from './radar';
import { flightRankingUrl } from './ranking-links';
import { FlightControls } from './input';
import { ControlSettings } from './control-settings';
import { FlightAudio } from './audio';
import { createGame, DURATION, STALL_SPEED, startGame, stepGame, pauseGame, resumeGame, SCORE_AMMO_REFERENCE, damagePenaltyPoints, PLAYER_RELOAD_TICKS } from './simulation';
import { AIM_COLORS, aimIndicator, aimRadius, aircraftMarkers } from './aim-indicator';
import { createShareText, formatFlightTime, shareFlightResult } from './sharing';
import type { FlightInput, GameEvent, GameMode } from './types';
import { rankingService, PLAYER_NAME_STORAGE_KEY, type RankingPlayHandle, type RankingPlayStatus } from './ranking';
import { updateDisplayDiagnostics } from './display-diagnostics';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = el('app');
const canvas = el<HTMLCanvasElement>('flight');
const markers = el<HTMLCanvasElement>('aircraft-markers');
const markerContext = markers.getContext('2d');
const name = el<HTMLInputElement>('pilot-name');
const soundButtons = [el<HTMLButtonElement>('sound'), el<HTMLButtonElement>('pause-sound'), el<HTMLButtonElement>('result-sound')];
const audio = new FlightAudio();

let selectedMode: GameMode = 'easy';
let game = createGame(20260928, selectedMode);
let pilot = '';
let rankingPlay: RankingPlayHandle | null = null;
let rankingRequest = 0;
let scene: FlightScene;
let controls: FlightControls;
let settings: ControlSettings;
let frameId = 0;
let lastTime = 0;
let accumulator = 0;
let displayClock = 0;
let noticeUntil = 0;
let spawnBannerUntil = 0;
let damageUntil = 0;
let finished = false;
let contextLost = false;
let resultEpoch = 0;
let shareActionBusy = false;
let resultShareText = '';
let clearResultActionTokens: () => void = () => undefined;
const pauses = new Set<string>();

const fmt = (value: number) => Math.floor(Math.max(0, Number.isFinite(value) ? value : 0)).toLocaleString('ja-JP');
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

function recordingMessage(status: RankingPlayStatus): string {
  switch (status.state) {
    case 'submitted': return 'ランキングに登録しました。';
    case 'unranked': return status.reason === 'anonymous'
      ? status.counted ? '名前未登録のためランク外です。プレイ回数は記録しました。' : '名前未登録のためランク外です。プレイ回数はまだ確認できていません。'
      : 'このプレイはランキング対象外です。';
    case 'started': return 'プレイ回数を記録しました。終了後にスコアを送信します。';
    case 'starting': return 'プレイ記録を送信しています。';
    case 'queued': return 'プレイ記録の送信を待っています。';
    case 'retryable_failed': return '記録の送信を確認できませんでした。結果を保ったまま再試行できます。';
    case 'permanent_failed': return '現在、記録を登録できません。ゲームはそのまま遊べます。';
    case 'local_unrecorded': return 'このプレイの記録は送信できていません。';
    default: return '記録を送信しています。';
  }
}

function updateRecordingStatus(): void {
  const pending = rankingService.getPendingStatus();
  const homeStatus = el('home-record-status');
  homeStatus.textContent = pending.pendingCount > 0
    ? `未確認のプレイ記録が${pending.pendingCount}件あります。再試行しても回数は重複しません。`
    : '';
  const homeRetry = el<HTMLButtonElement>('home-record-retry');
  homeRetry.hidden = pending.retryableCount === 0;
  if (!rankingPlay || !finished) return;
  const status = rankingService.getPlayStatus(rankingPlay);
  if (!status) return;
  el('record-status').textContent = recordingMessage(status);
  const button = el<HTMLButtonElement>('record-retry');
  button.hidden = status.state !== 'retryable_failed';
}

async function loadRanking(): Promise<void> {
  if (!finished) return;
  const epoch = resultEpoch;
  const request = ++rankingRequest;
  const mode = game.mode;
  const button = el<HTMLButtonElement>('ranking-refresh');
  button.disabled = true;
  el('ranking-status').textContent = 'ランキングを読み込んでいます。';
  el('ranking-table').hidden = true;
  const result = await rankingService.fetchBestRanking(mode, 30);
  if (epoch !== resultEpoch || request !== rankingRequest || !finished) return;
  button.disabled = false;
  const rows = el('ranking-rows');
  rows.replaceChildren();
  if (result.state !== 'ready') {
    el('ranking-status').textContent = 'ランキングを読み込めませんでした。結果はそのままです。';
    return;
  }
  for (const row of result.rows) {
    const tr = document.createElement('tr');
    for (const value of [`${row.rank_no}位`, row.display_name, `${fmt(row.best_score)}点`]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    rows.append(tr);
  }
  el('ranking-table').hidden = result.rows.length === 0;
  el('ranking-status').textContent = result.rows.length === 0 ? 'まだランキングの記録がありません。' : '';
}

async function retryRecords(): Promise<void> {
  const epoch = resultEpoch;
  const ids = ['record-retry', 'home-record-retry'];
  for (const id of ids) el<HTMLButtonElement>(id).disabled = true;
  try { await rankingService.retryPending(); }
  finally {
    for (const id of ids) el<HTMLButtonElement>(id).disabled = false;
    updateRecordingStatus();
    if (epoch === resultEpoch && finished) void loadRanking();
  }
}

function currentAspect(): number {
  const bounds = app.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0 ? bounds.width / bounds.height : 1;
}

function notice(message: string): void {
  el('feedback').textContent = message;
  noticeUntil = game.elapsed + 1.7;
}

function setShareActionsBusy(busy: boolean): void {
  shareActionBusy = busy;
  for (const id of ['share-result']) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button) button.disabled = busy;
  }
}

function installResultActionGuard(): () => void {
  const result = el('result');
  const starts = new Map<number, { action: HTMLElement; epoch: number }>();
  let released: { action: HTMLElement; epoch: number } | null = null;
  const actionFor = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const action = target.closest<HTMLElement>('#result button, #result a[href]');
    if (!action || !result.contains(action)) return null;
    if (action instanceof HTMLButtonElement && action.disabled) return null;
    return action;
  };
  const pointerDown = (event: PointerEvent): void => {
    released = null;
    const action = actionFor(event.target);
    if (!finished || result.hidden || !action) {
      starts.delete(event.pointerId);
      return;
    }
    starts.set(event.pointerId, { action, epoch: resultEpoch });
  };
  const pointerUp = (event: PointerEvent): void => {
    const start = starts.get(event.pointerId);
    starts.delete(event.pointerId);
    const action = actionFor(event.target);
    released = start && action === start.action && start.epoch === resultEpoch && finished && !result.hidden
      ? { action, epoch: resultEpoch }
      : null;
  };
  const pointerCancel = (event: PointerEvent): void => {
    starts.delete(event.pointerId);
    released = null;
  };
  const click = (event: MouseEvent): void => {
    const action = actionFor(event.target);
    if (!action) return;
    if (!finished || result.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      released = null;
      return;
    }
    if (event.detail === 0) {
      released = null;
      return;
    }
    const allowed = released?.action === action && released.epoch === resultEpoch;
    released = null;
    if (!allowed) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const clearOnPointerDown = (): void => { released = null; };
  const clearOnPointerUp = (event: PointerEvent): void => {
    starts.delete(event.pointerId);
    if (!actionFor(event.target)) released = null;
  };

  result.addEventListener('pointerdown', pointerDown, { capture: true });
  result.addEventListener('pointerup', pointerUp, { capture: true });
  result.addEventListener('click', click, { capture: true });
  window.addEventListener('pointerdown', clearOnPointerDown, { capture: true });
  window.addEventListener('pointerup', clearOnPointerUp);
  window.addEventListener('pointercancel', pointerCancel, { capture: true });
  return () => {
    starts.clear();
    released = null;
  };
}

function announceSpawn(message = '新たな敵機を確認'): void {
  el('spawn-banner').textContent = message;
  spawnBannerUntil = game.elapsed + 2.5;
}

function setSoundLabel(): void {
  for (const button of soundButtons) {
    button.textContent = audio.failed && audio.enabled ? '音 再試行' : audio.enabled ? '音 ON' : '音 OFF';
    button.setAttribute('aria-pressed', String(audio.enabled));
    button.setAttribute('aria-label', audio.enabled ? '効果音を切る' : '効果音を入れる');
  }
}

function updateModeDescription(mode: GameMode): void {
  el<HTMLAnchorElement>('home-ranking-link').href = flightRankingUrl(mode);
  const instructions = el('mode-instructions');
  const description = el('mode-description');
  if (mode === 'normal') {
    instructions.textContent = '空のどこでもドラッグして操縦。射撃・宙返り・加速・減速は画面のボタンで操作。';
    description.textContent = '時間無制限。射撃は手動で、弾切れ後は6秒で再装填します。';
  } else {
    instructions.textContent = '空のどこでもドラッグして操縦。射撃は自動です。宙返りは画面のボタンかLキーで操作。';
    description.textContent = '300秒。自動射撃で、弾切れ後は6秒で再装填します。操作するボタンは宙返りだけです。';
  }
}

function showHome(): void {
  rankingPlay = null;
  resultEpoch += 1;
  clearResultActionTokens();
  setShareActionsBusy(false);
  settings?.close();
  controls?.clear();
  controls?.setMode(selectedMode);
  settings?.setActiveMode(selectedMode);
  audio.active = false;
  audio.sync();
  pauses.clear();
  game = createGame(20260928, selectedMode);
  finished = false;
  noticeUntil = 0;
  damageUntil = 0;
  resultShareText = '';
  accumulator = 0;
  lastTime = performance.now();
  app.classList.remove('playing', 'easy-mode');
  el('home').hidden = false;
  for (const id of ['hud', 'pause-screen', 'result']) el(id).hidden = true;
  el('damage-flash').style.opacity = '0';
  el('feedback').textContent = '';
  el('spawn-banner').textContent = '';
  el('share-status').textContent = '';
  el('altitude-warning').hidden = true;
  updateDisplayDiagnostics();
}

function begin(): void {
  if (game.phase === 'playing' || game.phase === 'paused') return;
  const candidate = name.value.trim();
  if (Array.from(candidate).length > 20) {
    el('name-error').textContent = '名前は20文字以内で入力してください。';
    name.focus();
    return;
  }
  if (contextLost) return;
  pilot = candidate;
  try { localStorage.setItem(PLAYER_NAME_STORAGE_KEY, pilot); } catch { /* Gameplay is available without storage. */ }
  name.value = pilot;
  el('name-error').textContent = '';
  resultEpoch += 1;
  clearResultActionTokens();
  setShareActionsBusy(false);
  noticeUntil = 0;
  damageUntil = 0;
  el('feedback').textContent = '';
  resultShareText = '';
  game = createGame(20260928, selectedMode);
  startGame(game);
  rankingPlay = rankingService.beginPlay({ mode: game.mode, displayName: pilot || null });
  pauses.clear();
  finished = false;
  accumulator = 0;
  lastTime = performance.now();
  controls.clear();
  controls.setMode(game.mode);
  settings.setActiveMode(game.mode);
  app.classList.add('playing');
  app.classList.toggle('easy-mode', game.mode === 'easy');
  el('home').hidden = true;
  el('result').hidden = true;
  el('pause-screen').hidden = true;
  el('hud').hidden = false;
  audio.resetFlight();
  audio.active = true;
  void audio.unlock().then(setSoundLabel);
  audio.sync();
  announceSpawn('前方に敵機を確認');
  updateHud();
  canvas.focus({ preventScroll: true });
}

function pause(reason: string): void {
  if (game.phase !== 'playing' && game.phase !== 'paused') {
    audio.sync();
    return;
  }
  pauses.add(reason);
  pauseGame(game);
  controls.clear();
  accumulator = 0;
  audio.active = false;
  audio.sync();
  el('pause-screen').hidden = false;
  el('pause-note').textContent = reason === 'slow'
    ? '画面の更新が止まったため一時停止しました。準備ができたら再開できます。'
    : reason === 'context'
      ? '描画を復旧しています。'
      : '準備ができたら、飛行を再開できます。';
}

function resume(): void {
  if (document.hidden || contextLost || settings.isOpen) return;
  pauses.clear();
  resumeGame(game);
  controls.clear();
  lastTime = performance.now();
  accumulator = 0;
  el('pause-screen').hidden = true;
  audio.active = true;
  void audio.unlock().then(setSoundLabel);
  audio.sync();
  canvas.focus({ preventScroll: true });
}

function finish(): void {
  if (finished) return;
  finished = true;
  resultEpoch += 1;
  clearResultActionTokens();
  setShareActionsBusy(false);
  controls.clear();
  damageUntil = 0;
  el('damage-flash').style.opacity = '0';
  audio.finishFlight();
  el('hud').hidden = true;
  el('pause-screen').hidden = true;
  el('result').hidden = false;
  updateDisplayDiagnostics();
  el('altitude-warning').hidden = true;
  el('ranking-title').textContent = `${game.mode === 'easy' ? 'イージー' : 'ノーマル'} 上位30位`;
  el('record-status').textContent = '';
  el('record-retry').hidden = true;
  const completedPlay = rankingPlay;
  const completedEpoch = resultEpoch;
  if (completedPlay) {
    void rankingService.finishPlay(completedPlay, { resultType: 'game_over', score: game.score }).then(() => {
      if (resultEpoch !== completedEpoch || !finished) return;
      updateRecordingStatus();
      void loadRanking();
    });
  }
  updateRecordingStatus();
  void loadRanking();
  el('result-pilot').textContent = pilot ? `${pilot}さんの記録` : '名前未登録の記録';
  el('result-mode').textContent = game.mode === 'easy'
    ? 'イージー — 300秒・自動射撃・6秒再装填'
    : 'ノーマル — 時間無制限・手動射撃・6秒再装填';
  el('result-score').textContent = fmt(game.score);
  el<HTMLAnchorElement>('ranking-lab-link').href = flightRankingUrl(game.mode);
  el<HTMLAnchorElement>('result-ranking-link').href = flightRankingUrl(game.mode);
  el('result-reason').textContent = game.endReason === 'time'
    ? '300秒の飛行を終えました'
    : game.endReason === 'collision'
        ? '敵機と衝突したため飛行終了'
      : game.endReason === 'low-altitude'
        ? '低高度の警告から10秒が経過しました'
        : '機体が撃墜されました';

  const killPoints = (game.kills - game.contactKills) * 1000;
  const ammoPoints = Math.floor(killPoints * Math.max(0, 1 - game.shots / SCORE_AMMO_REFERENCE));
  const loopPoints = game.loops * 150;
  const damagePenalty = damagePenaltyPoints(game.damageTaken);
  el('result-kill-points').textContent = `${fmt(killPoints)}点`;
  el('result-ammo-points').textContent = `${fmt(ammoPoints)}点`;
  el('result-loop-points').textContent = `${fmt(loopPoints)}点`;
  el('result-penalty-points').textContent = `−${fmt(damagePenalty)}点`;
  el('result-kills').textContent = `${fmt(game.kills)}機`;
  el('result-shots').textContent = `${fmt(game.shots)}発`;
  el('result-loops').textContent = `${fmt(game.loops)}回`;
  el('result-time').textContent = formatFlightTime(game.elapsed);
  el('result-damage').textContent = `−${fmt(damagePenalty)}点（損傷 ${fmt(game.damageTaken)} HP）`;
  resultShareText = createShareText({
    score: game.score,
    kills: game.kills,
    shots: game.shots,
    loops: game.loops,
    damageTaken: game.damageTaken,
    time: game.elapsed,
    mode: game.mode,
  });
  el('share-status').textContent = '';
  el('result').scrollTop = 0;
  el('result').querySelector<HTMLElement>('.result-details')!.scrollTop = 0;
  el('result-title').setAttribute('tabindex', '-1');
  el('result-title').focus({ preventScroll: true });
  requestAnimationFrame(updateDisplayDiagnostics);
}

function updateHud(): void {
  const p = game.player;
  const remaining = game.lowAltitudeRemaining;
  const warning = el('altitude-warning');
  warning.hidden = remaining === null || (game.phase !== 'playing' && game.phase !== 'paused');
  if (!warning.hidden) {
    const text = `低高度警告 — あと${Math.ceil(remaining!)}秒で飛行終了`;
    if (warning.textContent !== text) warning.textContent = text;
  }
  el('timer-label').textContent = game.mode === 'easy' ? '残り時間' : '経過（無制限）';
  el('timer').textContent = game.mode === 'easy' ? clock(Math.ceil(Math.max(0, DURATION - game.elapsed))) : clock(game.elapsed);
  el('health').textContent = `${Math.max(0, Math.ceil(p.health))} HP`;
  const healthPercent = Math.max(0, Math.min(100, p.health / p.maxHealth * 100));
  el('health-fill').style.width = `${healthPercent}%`;
  el('health-fill').style.background = healthPercent < 35 ? '#efab84' : '#bdd9c7';
  el('kills').textContent = fmt(game.kills);
  el('loops').textContent = fmt(game.loops);
  el('score').textContent = fmt(game.score);
  el('mg').textContent = fmt(p.mg);
  el('cannon').textContent = fmt(p.cannon);
  el('ammo-total').textContent = fmt(p.mg + p.cannon);
  el('ammo-title').textContent = p.reloadTicksRemaining > 0 ? '再装填中' : '残弾';
  const reloading = p.reloadTicksRemaining > 0;
  el('reload-status').hidden = !reloading;
  el('reload-status').textContent = reloading ? `再装填中 あと${(p.reloadTicksRemaining / 60).toFixed(1)}秒` : '';
  el('reload-status').dataset.progress = String(1 - p.reloadTicksRemaining / PLAYER_RELOAD_TICKS);
  el('speed').textContent = fmt(p.speed * 3.6);
  el('altitude').textContent = fmt(p.position.y);
  el('loop-status').textContent = p.loopProgress > 0
    ? '宙返り中'
    : p.loopCooldown > 0
      ? `次の宙返りまで ${p.loopCooldown.toFixed(1)}秒`
      : p.speed < STALL_SPEED
        ? '宙返りには速度が必要'
        : '宙返り可能';
  el('loop').setAttribute('aria-disabled', String(p.loopProgress > 0 || p.loopCooldown > 0 || p.speed < STALL_SPEED));
  if (game.elapsed > noticeUntil) el('feedback').textContent = '';
  if (game.elapsed > spawnBannerUntil) el('spawn-banner').textContent = '';
  const damageFlashVisible = (game.phase === 'playing' || game.phase === 'paused') && game.elapsed < damageUntil;
  el('damage-flash').style.opacity = damageFlashVisible ? '.5' : '0';
}

function onEvents(events: GameEvent[]): void {
  for (const event of events) {
    audio.event(event, event.owner === game.player.id);
    if (event.type === 'spawn') announceSpawn('新たな敵機を確認');
    if (event.type === 'kill' && event.owner === game.player.id) notice('撃墜');
    if (event.type === 'loop' && event.owner === game.player.id) notice('宙返り +150');
    if (event.type === 'damage' && event.owner === game.player.id) {
      notice('被弾 — 損傷に応じて減点');
      damageUntil = game.elapsed + .3;
    }
  }
}

function updateReticle(): void {
  const bounds = app.getBoundingClientRect();
  const width = bounds.width, height = bounds.height;
  if (width <= 0 || height <= 0) return;
  const sight = game.mode === 'easy' ? { x: width / 2, y: height / 2 } : scene.aimScreen();
  const radius = aimRadius(game.mode, width, height);
  const indicator = aimIndicator(game, game.enemies, sight, width, height);
  const reticle = el('reticle');
  reticle.classList.toggle('easy-aim', game.mode === 'easy');
  reticle.dataset.indicator = indicator;
  reticle.style.setProperty('--aim-color', AIM_COLORS[indicator]);
  reticle.style.left = `${sight.x}px`;
  reticle.style.top = `${sight.y}px`;
  reticle.style.width = `${radius * 2}px`;
  reticle.style.height = `${radius * 2}px`;
  el('reload-status').style.left = `${sight.x}px`;
  el('reload-status').style.top = `${sight.y + radius + 18}px`;
  drawAircraftMarkers(sight, radius, width, height);
}

function drawAircraftMarkers(sight: { x: number; y: number }, radius: number, width: number, height: number): void {
  const c = markerContext;
  if (!c) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const bufferWidth = Math.round(width * ratio), bufferHeight = Math.round(height * ratio);
  if (markers.width !== bufferWidth || markers.height !== bufferHeight) {
    markers.width = bufferWidth;
    markers.height = bufferHeight;
  }
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  c.clearRect(0, 0, width, height);
  c.shadowBlur = 0;
  if (game.phase !== 'playing' && game.phase !== 'paused') return;
  if (game.player.reloadTicksRemaining > 0) {
    const progress = 1 - game.player.reloadTicksRemaining / PLAYER_RELOAD_TICKS;
    c.strokeStyle = 'rgba(7,30,43,.8)';
    c.lineWidth = 5;
    c.beginPath(); c.arc(sight.x, sight.y, radius + 7, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = '#ffd27a';
    c.lineWidth = 3;
    c.beginPath(); c.arc(sight.x, sight.y, radius + 7, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); c.stroke();
  }
  c.shadowColor = 'rgba(0,20,30,.9)';
  c.shadowBlur = 3;
  c.font = '600 11px system-ui';
  c.textAlign = 'center';
  for (const marker of aircraftMarkers(game, width, height)) {
    const { x, y } = marker;
    c.strokeStyle = '#ffb28b';
    c.lineWidth = 1.25;
    c.beginPath();
    c.moveTo(x, y - 6); c.lineTo(x + 5, y); c.lineTo(x, y + 6); c.lineTo(x - 5, y); c.closePath(); c.stroke();
    c.fillStyle = 'rgba(7,24,32,.8)';
    c.fillRect(x - 19, y + 12, 38, 3);
    c.fillStyle = '#ffc69b';
    c.fillRect(x - 19, y + 12, 38 * marker.healthFraction, 3);
    c.fillStyle = '#f4e3c8';
    c.fillText(`${marker.distance}m`, x, y + 28);
  }
  c.shadowBlur = 0;
}

function frame(time: number): void {
  frameId = requestAnimationFrame(frame);
  const raw = (time - (lastTime || time)) / 1000;
  lastTime = time;
  if (raw > 1 && game.phase === 'playing') pause('slow');
  const dt = Math.min(raw, .25);
  if (game.phase === 'playing') {
    accumulator += raw;
    const gathered: GameEvent[] = [];
    let sampledInput: FlightInput | null = null;
    let firstStep = true;
    while (accumulator >= 1 / 60 && game.phase === 'playing') {
      sampledInput ??= controls.sample();
      const tickInput: FlightInput = {
        ...sampledInput,
        loop: firstStep && sampledInput.loop,
        viewAspect: currentAspect(),
      };
      firstStep = false;
      stepGame(game, tickInput, 1 / 60);
      gathered.push(...game.events);
      accumulator -= 1 / 60;
    }
    game.events = gathered;
    onEvents(gathered);
    audio.update(game.player.speed);
    if (game.endReason !== null) finish();
  } else if (game.phase === 'ended' && !document.hidden) {
    accumulator += dt;
    while (accumulator >= 1 / 60) {
      stepGame(game, { turn: 0, climb: 0, fire: false, loop: false, viewAspect: currentAspect() }, 1 / 60);
      accumulator -= 1 / 60;
    }
  }
  if (!contextLost) {
    scene.render(game, game.phase === 'paused' || document.hidden ? 0 : dt);
    updateReticle();
  }
  displayClock += dt;
  if (displayClock >= .08) {
    displayClock = 0;
    updateHud();
    radar.draw(game);
  }
}

const radar = new SphereRadar(el<HTMLCanvasElement>('radar'));

function resize(): void {
  const rect = app.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) scene.resize(rect.width, rect.height);
  updateDisplayDiagnostics();
}

function fatal(error: unknown): void {
  cancelAnimationFrame(frameId);
  el('loading').hidden = true;
  el('error-screen').hidden = false;
  el('error-text').textContent = '3Dの画面を開けませんでした。Safariなどの新しいブラウザで、読み込み直してください。';
  console.error('Flight initialization failed', error);
}

try {
  scene = new FlightScene(canvas);
  resize();
  const buttons = {
    fire: el<HTMLButtonElement>('fire'),
    loop: el<HTMLButtonElement>('loop'),
    accelerate: el<HTMLButtonElement>('accelerate'),
    brake: el<HTMLButtonElement>('brake'),
  };
  settings = new ControlSettings(buttons);
  controls = new FlightControls(canvas, buttons, () => game.phase === 'playing' && !settings.isOpen);
  clearResultActionTokens = installResultActionGuard();
  controls.setMode(selectedMode);
  updateModeDescription(selectedMode);
  setSoundLabel();
  el('loading').hidden = true;
  showHome();
  try { name.value = localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || ''; } catch { /* Optional saved name. */ }
  rankingService.subscribe(updateRecordingStatus);
  for (const id of ['record-retry', 'home-record-retry']) el(id).addEventListener('click', () => { void retryRecords(); });
  el('ranking-refresh').addEventListener('click', () => { void loadRanking(); });
  frameId = requestAnimationFrame(frame);
  new ResizeObserver(resize).observe(app);
  window.visualViewport?.addEventListener('resize', resize);
  el('start-form').addEventListener('submit', event => {
    event.preventDefault();
    begin();
  });
  for (const radio of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="game-mode"]'))) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      selectedMode = radio.value === 'easy' ? 'easy' : 'normal';
      game = createGame(20260928, selectedMode);
      controls.setMode(selectedMode);
      settings.setActiveMode(selectedMode);
      updateModeDescription(selectedMode);
    });
  }
  el('pause').addEventListener('click', () => pause('manual'));
  el('resume').addEventListener('click', resume);
  el('quit').addEventListener('click', showHome);
  el('result-return-home').addEventListener('click', event => {
    // Keep the normal in-page reset; href remains a usable navigation fallback.
    event.preventDefault();
    showHome();
  });
  el('retry').addEventListener('click', begin);
  const about = el<HTMLDialogElement>('about');
  el('about-open').addEventListener('click', () => about.showModal());
  el('about-close').addEventListener('click', () => about.close());

  const settingsEntries: Array<[string, () => GameMode, boolean]> = [
    ['home-controls', () => selectedMode, true],
    ['pause-controls', () => game.mode, false],
    ['result-controls', () => game.mode, true],
  ];
  for (const [id, mode, allowBothModes] of settingsEntries) {
    const button = el<HTMLButtonElement>(id);
    button.addEventListener('click', () => {
      controls.clear();
      settings.open(button, mode(), allowBothModes);
    });
  }

  for (const button of soundButtons) {
    button.addEventListener('click', () => {
      if (audio.failed && audio.enabled) {
        void audio.unlock().then(setSoundLabel);
        return;
      }
      audio.enabled = !audio.enabled;
      if (audio.enabled) void audio.unlock().then(setSoundLabel);
      audio.sync();
      setSoundLabel();
    });
  }

  el('share-result').addEventListener('click', async () => {
    if (shareActionBusy) return;
    const epoch = resultEpoch;
    setShareActionsBusy(true);
    const outcome = await shareFlightResult(resultShareText);
    if (epoch !== resultEpoch || !finished || el('result').hidden) return;
    setShareActionsBusy(false);
    const status = el('share-status');
    if (outcome === 'shared') status.textContent = '共有画面の操作が完了しました。';
    else if (outcome === 'cancelled') status.textContent = '共有は完了していません。結果はそのままです。';
    else status.textContent = '共有を利用できません。文章を選択するか、コピーしてください。';
  });


  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause('hidden');
  });
  window.addEventListener('blur', () => {
    controls.clear();
    pause('focus');
  });
  window.addEventListener('pagehide', () => pause('pagehide'));
  window.addEventListener('pageshow', () => {
    lastTime = performance.now();
    if (game.phase === 'paused') resize();
    updateDisplayDiagnostics();
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    pause('context');
    if (game.phase === 'ready' || game.phase === 'ended') el('error-screen').hidden = false;
    el<HTMLButtonElement>('resume').disabled = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    el('error-screen').hidden = true;
    el<HTMLButtonElement>('resume').disabled = false;
    el('pause-note').textContent = '画面が復旧しました。飛行を再開できます。';
    resize();
  });

  if (import.meta.env.DEV) {
    Object.defineProperty(window, 'flightSnapshot', {
      configurable: true,
      value: () => JSON.parse(JSON.stringify({
        mode: game.mode,
        phase: game.phase,
        elapsed: game.elapsed,
        kills: game.kills,
        contactKills: game.contactKills,
        shots: game.shots,
        loops: game.loops,
        score: game.score,
        damageTaken: game.damageTaken,
        player: {
          position: game.player.position.toArray(),
          quaternion: game.player.quaternion.toArray(),
          speed: game.player.speed,
          health: game.player.health,
          maxHealth: game.player.maxHealth,
          reloadTicksRemaining: game.player.reloadTicksRemaining,
          mg: game.player.mg,
          cannon: game.player.cannon,
          loopProgress: game.player.loopProgress,
        },
        enemies: game.enemies.map(enemy => ({
          id: enemy.id,
          position: enemy.position.toArray(),
          mode: enemy.mode,
          health: enemy.health,
          maxHealth: enemy.maxHealth,
          speed: enemy.speed,
          mg: enemy.mg,
          cannon: enemy.cannon,
        })),
        wrecks: game.wrecks.map(wreck => ({ id: wreck.id, position: wreck.position.toArray(), age: wreck.age })),
        bullets: game.bullets.length,
        endReason: game.endReason,
        lowAltitudeRemaining: game.lowAltitudeRemaining,
        render: scene.stats(),
      })),
    });
  }
} catch (error) {
  fatal(error);
}

el('reload').addEventListener('click', () => location.reload());

