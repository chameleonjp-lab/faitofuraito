import type { FlightControlButtons } from './input';

type ControlName = keyof FlightControlButtons;
type ControlPlacement = { x: number; y: number; size: number; opacity: number };
type ControlLayout = Record<ControlName, ControlPlacement>;
type Insets = { top: number; right: number; bottom: number; left: number };

const STORAGE_KEY = 'faitofuraito-controls-v1';
const CONTROL_NAMES: ControlName[] = ['fire', 'loop', 'accelerate', 'brake'];
const DEFAULT_LAYOUT: ControlLayout = {
  fire: { x: 0.83, y: 0.84, size: 96, opacity: 0.9 },
  loop: { x: 0.83, y: 0.66, size: 72, opacity: 0.78 },
  accelerate: { x: 0.17, y: 0.84, size: 76, opacity: 0.82 },
  brake: { x: 0.17, y: 0.66, size: 76, opacity: 0.82 },
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const copyLayout = (layout: ControlLayout): ControlLayout => Object.fromEntries(
  CONTROL_NAMES.map(name => [name, { ...layout[name] }]),
) as ControlLayout;

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function loadLayout(): ControlLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return copyLayout(DEFAULT_LAYOUT);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
      return copyLayout(DEFAULT_LAYOUT);
    }
    const source = (parsed as { controls?: unknown }).controls;
    if (!source || typeof source !== 'object') return copyLayout(DEFAULT_LAYOUT);
    const values = source as Record<string, unknown>;
    const layout = copyLayout(DEFAULT_LAYOUT);
    for (const name of CONTROL_NAMES) {
      const value = values[name];
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      layout[name] = {
        x: readNumber(item.x, layout[name].x, 0, 1),
        y: readNumber(item.y, layout[name].y, 0, 1),
        size: readNumber(item.size, layout[name].size, 44, 140),
        opacity: readNumber(item.opacity, layout[name].opacity, 0.2, 1),
      };
    }
    return layout;
  } catch {
    // Private browsing and hardened webviews can deny storage access.
    return copyLayout(DEFAULT_LAYOUT);
  }
}

/** Edits and persists the four in-flight button layouts without resuming flight. */
export class ControlSettings {
  private readonly app: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private readonly preview: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly ranges: Record<'x' | 'y' | 'size' | 'opacity', HTMLInputElement>;
  private readonly outputs: Record<'x' | 'y' | 'size' | 'opacity', HTMLElement>;
  private readonly safeProbe: HTMLElement;
  private readonly observer: ResizeObserver;
  private readonly abort = new AbortController();
  private saved: ControlLayout;
  private draft: ControlLayout;
  private selected: ControlName = 'fire';
  private returnFocus: HTMLElement | null = null;
  private dragPointer: number | null = null;
  private dragControl: ControlName | null = null;
  private storageUnavailable = false;
  private saveFailedAwaitingUse = false;

  get isOpen(): boolean {
    return this.dialog.open;
  }

  constructor(private readonly buttons: FlightControlButtons) {
    this.app = document.getElementById('app') ?? document.body;
    this.saved = loadLayout();
    this.draft = copyLayout(this.saved);
    this.dialog = this.createDialog();
    this.preview = this.dialog.querySelector<HTMLElement>('#control-preview')!;
    this.select = this.dialog.querySelector<HTMLSelectElement>('#control-target')!;
    this.ranges = {
      x: this.dialog.querySelector<HTMLInputElement>('#control-x')!,
      y: this.dialog.querySelector<HTMLInputElement>('#control-y')!,
      size: this.dialog.querySelector<HTMLInputElement>('#control-size')!,
      opacity: this.dialog.querySelector<HTMLInputElement>('#control-opacity')!,
    };
    this.outputs = {
      x: this.dialog.querySelector<HTMLElement>('#control-x-value')!,
      y: this.dialog.querySelector<HTMLElement>('#control-y-value')!,
      size: this.dialog.querySelector<HTMLElement>('#control-size-value')!,
      opacity: this.dialog.querySelector<HTMLElement>('#control-opacity-value')!,
    };
    this.safeProbe = document.createElement('span');
    this.safeProbe.className = 'control-safe-area-probe';
    this.safeProbe.setAttribute('aria-hidden', 'true');
    this.app.append(this.safeProbe);
    this.bindEvents();
    this.apply(this.saved);
    this.observer = new ResizeObserver(() => this.refreshLayout());
    this.observer.observe(this.app);
    window.visualViewport?.addEventListener('resize', this.refreshLayout, { signal: this.abort.signal });
  }

  open(returnFocus?: HTMLElement): void {
    if (this.dialog.open) return;
    this.returnFocus = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.draft = copyLayout(this.saved);
    this.saveFailedAwaitingUse = false;
    this.selected = 'fire';
    this.select.value = this.selected;
    this.dialog.querySelector<HTMLButtonElement>('#control-save')!.textContent = '保存する';
    this.refreshLayout();
    this.dialog.showModal();
    this.refreshLayout();
    this.dialog.querySelector<HTMLButtonElement>('#control-cancel')?.focus({ preventScroll: true });
  }

  close(): void {
    if (this.dialog.open) this.dialog.close('discard');
  }

  dispose(): void {
    this.close();
    this.abort.abort();
    this.observer.disconnect();
    this.safeProbe.remove();
    this.dialog.remove();
  }

  private createDialog(): HTMLDialogElement {
    const dialog = document.createElement('dialog');
    dialog.id = 'control-settings';
    dialog.className = 'control-settings-dialog';
    dialog.setAttribute('aria-labelledby', 'control-settings-title');
    dialog.innerHTML = `
      <div class="settings-shell">
        <header class="settings-header">
          <div><p class="eyebrow">FLIGHT CONTROLS</p><h2 id="control-settings-title">操作ボタンの配置</h2></div>
          <button id="control-close" class="settings-close" type="button" aria-label="設定を閉じる">×</button>
        </header>
        <div class="settings-main">
          <p class="settings-hint">ボタンをドラッグするか、位置スライダーで調整できます。</p>
          <div id="control-preview" class="control-preview" aria-label="操作画面の配置プレビュー"></div>
          <label class="control-select-label" for="control-target">調整するボタン</label>
          <select id="control-target" class="control-target">
            <option value="fire">射撃</option><option value="loop">宙返り</option>
            <option value="accelerate">加速</option><option value="brake">減速</option>
          </select>
          <button id="control-reset" class="control-reset" type="button">標準配置に戻す</button>
          <div class="control-settings-grid">
            <label class="setting-range" for="control-x"><span>横位置 <b id="control-x-value"></b></span><input id="control-x" type="range" min="5" max="95" step="1" aria-label="横位置"></label>
            <label class="setting-range" for="control-y"><span>縦位置 <b id="control-y-value"></b></span><input id="control-y" type="range" min="5" max="95" step="1" aria-label="縦位置"></label>
            <label class="setting-range" for="control-size"><span>ボタンの大きさ <b id="control-size-value"></b></span><input id="control-size" type="range" min="44" max="140" step="2" aria-label="ボタンの大きさ"></label>
            <label class="setting-range" for="control-opacity"><span>不透明度 <b id="control-opacity-value"></b></span><input id="control-opacity" type="range" min="20" max="100" step="1" aria-label="不透明度"></label>
          </div>
          <p id="control-storage-note" class="settings-storage-note" role="status" hidden>このブラウザでは設定を保存できないため、今回の表示中だけ有効です。</p>
        </div>
        <footer class="settings-footer">
          <button id="control-cancel" class="secondary" type="button">変更を破棄</button>
          <button id="control-save" class="primary" type="button">保存する</button>
        </footer>
      </div>`;
    this.app.append(dialog);
    return dialog;
  }

  private bindEvents(): void {
    const signal = this.abort.signal;
    this.dialog.querySelector('#control-close')?.addEventListener('click', () => this.close(), { signal });
    this.dialog.querySelector('#control-cancel')?.addEventListener('click', () => this.close(), { signal });
    this.dialog.querySelector('#control-save')?.addEventListener('click', () => this.save(), { signal });
    this.dialog.querySelector('#control-reset')?.addEventListener('click', () => {
      this.draft = copyLayout(DEFAULT_LAYOUT);
      this.updateEditor();
    }, { signal });
    this.dialog.addEventListener('cancel', event => {
      event.preventDefault();
      this.close();
    }, { signal });
    this.dialog.addEventListener('close', () => this.onClosed(), { signal });
    this.select.addEventListener('change', () => {
      this.selected = this.select.value as ControlName;
      this.updateEditor();
    }, { signal });
    for (const property of ['x', 'y', 'size', 'opacity'] as const) {
      this.ranges[property].addEventListener('input', () => this.changeValue(property), { signal });
    }
    this.preview.addEventListener('pointerdown', event => this.startDrag(event), { signal });
    this.preview.addEventListener('pointermove', event => this.drag(event), { signal });
    this.preview.addEventListener('pointerup', event => this.endDrag(event), { signal });
    this.preview.addEventListener('pointercancel', event => this.endDrag(event), { signal });
    this.preview.addEventListener('lostpointercapture', event => this.endDrag(event), { signal });
  }

  private save(): void {
    if (this.saveFailedAwaitingUse) {
      this.saved = copyLayout(this.draft);
      this.apply(this.saved);
      this.dialog.close('session-only');
      return;
    }
    const next = copyLayout(this.draft);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, controls: next }));
      this.storageUnavailable = false;
      this.saved = next;
      this.apply(this.saved);
    } catch {
      this.storageUnavailable = true;
      this.saveFailedAwaitingUse = true;
      this.dialog.querySelector<HTMLElement>('#control-storage-note')!.textContent = '設定を保存できませんでした。もう一度「今回だけ使う」を押すと、この画面中だけ設定を適用します。';
      this.dialog.querySelector<HTMLButtonElement>('#control-save')!.textContent = '今回だけ使う';
      this.dialog.querySelector<HTMLElement>('#control-storage-note')!.hidden = false;
      return;
    }
    this.dialog.close('save');
  }

  private onClosed(): void {
    this.draft = copyLayout(this.saved);
    this.dragPointer = null;
    this.dragControl = null;
    this.saveFailedAwaitingUse = false;
    this.updateEditor();
    const returnFocus = this.returnFocus;
    this.returnFocus = null;
    if (returnFocus?.isConnected && !returnFocus.closest('[hidden]')) {
      requestAnimationFrame(() => {
        if (returnFocus.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus({ preventScroll: true });
      });
    }
  }

  private changeValue(property: 'x' | 'y' | 'size' | 'opacity'): void {
    const value = Number(this.ranges[property].value);
    if (property === 'x' || property === 'y') this.draft[this.selected][property] = value / 100;
    else this.draft[this.selected][property] = property === 'opacity' ? value / 100 : value;
    this.updateEditor();
  }

  private startDrag(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.preview-control') : null;
    const name = target?.dataset.control as ControlName | undefined;
    if (!target || !name || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    this.selected = name;
    this.select.value = name;
    this.dragPointer = event.pointerId;
    this.dragControl = name;
    try { target.setPointerCapture(event.pointerId); } catch { /* The pointer can end before capture is established. */ }
    this.updateEditor();
    this.setFromPreviewPointer(event);
  }

  private drag(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointer) return;
    event.preventDefault();
    this.setFromPreviewPointer(event);
  }

  private endDrag(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointer) return;
    this.dragPointer = null;
    this.dragControl = null;
  }

  private setFromPreviewPointer(event: PointerEvent): void {
    if (!this.dragControl) return;
    const rect = this.preview.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const appWidth = this.app.getBoundingClientRect().width || 1;
    const position = this.bounds(this.dragControl, rect.width, rect.height, rect.width / appWidth, 2);
    this.draft[this.dragControl].x = clamp((event.clientX - rect.left) / rect.width, position.minX, position.maxX);
    this.draft[this.dragControl].y = clamp((event.clientY - rect.top) / rect.height, position.minY, position.maxY);
    this.updateEditor();
  }

  private updateEditor(): void {
    if (!this.dialog.isConnected) return;
    this.buildPreviewButtons();
    const rect = this.app.getBoundingClientRect();
    const bounds = this.bounds(this.selected, rect.width || 1, rect.height || 1, 1, 8);
    const current = this.draft[this.selected];
    const x = clamp(current.x, bounds.minX, bounds.maxX);
    const y = clamp(current.y, bounds.minY, bounds.maxY);
    this.ranges.x.min = String(Math.ceil(bounds.minX * 100));
    this.ranges.x.max = String(Math.floor(bounds.maxX * 100));
    this.ranges.y.min = String(Math.ceil(bounds.minY * 100));
    this.ranges.y.max = String(Math.floor(bounds.maxY * 100));
    this.ranges.x.value = String(Math.round(x * 100));
    this.ranges.y.value = String(Math.round(y * 100));
    this.ranges.size.value = String(Math.round(current.size));
    this.ranges.opacity.value = String(Math.round(current.opacity * 100));
    this.outputs.x.textContent = `${Math.round(x * 100)}%`;
    this.outputs.y.textContent = `${Math.round(y * 100)}%`;
    this.outputs.size.textContent = `${Math.round(current.size)}px`;
    this.outputs.opacity.textContent = `${Math.round(current.opacity * 100)}%`;
    const storageNote = this.dialog.querySelector<HTMLElement>('#control-storage-note')!;
    storageNote.hidden = !this.storageUnavailable;
    if (this.storageUnavailable && !this.saveFailedAwaitingUse) {
      storageNote.textContent = 'このブラウザでは設定を保存できないため、今回の表示中だけ有効です。';
    }
    this.stylePreviewButtons();
  }

  private buildPreviewButtons(): void {
    if (this.preview.childElementCount === CONTROL_NAMES.length) return;
    this.preview.replaceChildren();
    for (const name of CONTROL_NAMES) {
      const clone = this.buttons[name].cloneNode(true) as HTMLButtonElement;
      clone.removeAttribute('id');
      clone.removeAttribute('aria-pressed');
      clone.removeAttribute('aria-disabled');
      clone.dataset.control = name;
      clone.classList.add('preview-control');
      clone.classList.remove('is-pressed');
      clone.setAttribute('aria-hidden', 'true');
      clone.tabIndex = -1;
      this.preview.append(clone);
    }
  }

  private stylePreviewButtons(): void {
    const appRect = this.app.getBoundingClientRect();
    const previewRect = this.preview.getBoundingClientRect();
    if (!appRect.width || !previewRect.width) return;
    const scale = previewRect.width / appRect.width;
    for (const name of CONTROL_NAMES) {
      const control = this.draft[name];
      const element = this.preview.querySelector<HTMLElement>(`.preview-control[data-control="${name}"]`);
      if (!element) continue;
      const position = this.bounds(name, previewRect.width, previewRect.height, scale, 8 * scale, control.size);
      element.style.setProperty('--control-x', `${clamp(control.x, position.minX, position.maxX) * 100}%`);
      element.style.setProperty('--control-y', `${clamp(control.y, position.minY, position.maxY) * 100}%`);
      element.style.setProperty('--control-size', `${control.size * scale}px`);
      element.style.setProperty('--control-opacity', String(control.opacity));
      element.classList.toggle('is-selected', this.selected === name);
    }
  }

  private apply(layout: ControlLayout): void {
    const rect = this.app.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    for (const name of CONTROL_NAMES) {
      const control = layout[name];
      const position = this.bounds(name, rect.width, rect.height, 1, 8, control.size);
      const element = this.buttons[name];
      element.style.setProperty('--control-x', `${clamp(control.x, position.minX, position.maxX) * 100}%`);
      element.style.setProperty('--control-y', `${clamp(control.y, position.minY, position.maxY) * 100}%`);
      element.style.setProperty('--control-size', `${control.size}px`);
      element.style.setProperty('--control-opacity', String(control.opacity));
    }
  }

  private bounds(name: ControlName, width: number, height: number, scale: number, margin: number, buttonSize = this.draft[name].size): { minX: number; maxX: number; minY: number; maxY: number } {
    const size = buttonSize * scale;
    const insets = this.readInsets();
    const half = size / 2 + margin;
    const minX = clamp((insets.left * scale + half) / Math.max(1, width), 0.02, 0.48);
    const maxX = clamp(1 - (insets.right * scale + half) / Math.max(1, width), 0.52, 0.98);
    const minY = clamp((insets.top * scale + half) / Math.max(1, height), 0.02, 0.48);
    const maxY = clamp(1 - (insets.bottom * scale + half) / Math.max(1, height), 0.52, 0.98);
    return { minX, maxX: Math.max(minX, maxX), minY, maxY: Math.max(minY, maxY) };
  }

  private readInsets(): Insets {
    const style = getComputedStyle(this.safeProbe);
    return {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
    };
  }

  private refreshLayout = (): void => {
    this.apply(this.saved);
    if (!this.dialog?.open) return;
    const appRect = this.app.getBoundingClientRect();
    const availableHeight = Math.min(248, Math.max(125, window.innerHeight * 0.36));
    const availableWidth = Math.max(80, Math.min(this.dialog.clientWidth - 36, 300));
    const ratio = appRect.width > 0 && appRect.height > 0 ? appRect.width / appRect.height : 0.46;
    const height = Math.min(availableHeight, availableWidth / ratio);
    this.preview.style.width = `${height * ratio}px`;
    this.preview.style.height = `${height}px`;
    this.updateEditor();
  };
}
