import type { FlightInput } from './types';

export type FlightControlButtons = {
  fire: HTMLButtonElement;
  loop: HTMLButtonElement;
  accelerate: HTMLButtonElement;
  brake: HTMLButtonElement;
};

type ControlName = keyof FlightControlButtons;

const SHORTCUTS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyL', 'KeyW', 'KeyS']);

function neutralInput(): FlightInput {
  return { turn: 0, climb: 0, fire: false, loop: false, accelerate: false, brake: false };
}

/** Pointer and keyboard input for the four on-screen flight controls. */
export class FlightControls {
  private steerPointer: number | null = null;
  private readonly holds: Record<ControlName, Set<number>> = {
    fire: new Set(), loop: new Set(), accelerate: new Set(), brake: new Set(),
  };
  private readonly keys = new Set<string>();
  private readonly clickBursts = new Set<ControlName>();
  private loopEdge = false;
  private turn = 0;
  private climb = 0;
  private origin = { x: 0, y: 0 };
  private readonly abort = new AbortController();
  private readonly joystick: HTMLElement;
  private readonly knob: HTMLElement | null;

  constructor(
    private readonly surface: HTMLElement,
    private readonly buttons: FlightControlButtons,
    private readonly active: () => boolean,
  ) {
    const app = surface.closest<HTMLElement>('#app') ?? document.getElementById('app') ?? surface;
    let joystick = app.querySelector<HTMLElement>('#joystick');
    if (!joystick) {
      joystick = document.createElement('div');
      joystick.id = 'joystick';
      joystick.setAttribute('aria-hidden', 'true');
      joystick.innerHTML = '<i></i>';
      app.append(joystick);
    }
    this.joystick = joystick;
    this.knob = joystick.querySelector<HTMLElement>('i');

    const opts = { signal: this.abort.signal };
    surface.addEventListener('pointerdown', event => this.beginSteering(event, app), opts);
    surface.addEventListener('pointermove', event => this.moveSteering(event), opts);
    surface.addEventListener('pointerup', event => this.endSteering(event), opts);
    surface.addEventListener('pointercancel', event => this.endSteering(event), opts);
    surface.addEventListener('lostpointercapture', event => this.endSteering(event), opts);
    surface.addEventListener('contextmenu', event => event.preventDefault(), opts);

    for (const name of Object.keys(buttons) as ControlName[]) {
      const button = buttons[name];
      button.addEventListener('pointerdown', event => this.beginButton(name, button, event), opts);
      button.addEventListener('pointerup', event => this.endButton(name, button, event, true), opts);
      button.addEventListener('pointercancel', event => this.endButton(name, button, event, false), opts);
      button.addEventListener('lostpointercapture', event => this.endButton(name, button, event, false), opts);
      button.addEventListener('click', event => {
        // Keep native keyboard and assistive-technology activation while ignoring
        // the compatibility click generated after a pointer gesture.
        if (event.detail === 0 && this.active()) this.activateOnce(name);
      }, opts);
      button.addEventListener('contextmenu', event => event.preventDefault(), opts);
    }

    window.addEventListener('keydown', event => this.keyDown(event), opts);
    window.addEventListener('keyup', event => this.keyUp(event), opts);
    window.addEventListener('blur', () => this.clear(), opts);
    window.addEventListener('pagehide', () => this.clear(), opts);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    }, opts);
  }

  sample(): FlightInput {
    if (!this.active()) {
      this.clear();
      return neutralInput();
    }

    const turn = this.turn + Number(this.keys.has('ArrowRight')) - Number(this.keys.has('ArrowLeft'));
    const climb = this.climb + Number(this.keys.has('ArrowUp')) - Number(this.keys.has('ArrowDown'));
    const pressed = (name: ControlName) => this.holds[name].size > 0;
    const fire = pressed('fire') || this.keys.has('Space') || this.clickBursts.has('fire');
    const accelerate = pressed('accelerate') || this.keys.has('KeyW') || this.clickBursts.has('accelerate');
    const brake = pressed('brake') || this.keys.has('KeyS') || this.clickBursts.has('brake');
    const loop = this.loopEdge;

    this.loopEdge = false;
    this.clickBursts.clear();
    return {
      turn: Math.max(-1, Math.min(1, turn)),
      climb: Math.max(-1, Math.min(1, climb)),
      fire,
      loop,
      accelerate,
      brake,
    };
  }

  clear(): void {
    const steeringPointer = this.steerPointer;
    this.steerPointer = null;
    this.turn = 0;
    this.climb = 0;
    this.keys.clear();
    this.loopEdge = false;
    this.clickBursts.clear();
    this.joystick.classList.remove('visible');
    this.joystick.style.removeProperty('--joystick-x');
    this.joystick.style.removeProperty('--joystick-y');

    if (steeringPointer !== null) this.releaseCapture(this.surface, steeringPointer);
    for (const name of Object.keys(this.buttons) as ControlName[]) {
      const button = this.buttons[name];
      for (const pointer of this.holds[name]) this.releaseCapture(button, pointer);
      this.holds[name].clear();
      button.classList.remove('is-pressed');
      button.setAttribute('aria-pressed', 'false');
    }
  }

  dispose(): void {
    this.clear();
    this.abort.abort();
  }

  private beginSteering(event: PointerEvent, app: HTMLElement): void {
    if (!this.active() || this.steerPointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    this.steerPointer = event.pointerId;
    this.origin = { x: event.clientX, y: event.clientY };
    const appRect = app.getBoundingClientRect();
    this.joystick.style.left = `${event.clientX - appRect.left}px`;
    this.joystick.style.top = `${event.clientY - appRect.top}px`;
    this.joystick.classList.add('visible');
    this.joystick.style.setProperty('--joystick-x', '0px');
    this.joystick.style.setProperty('--joystick-y', '0px');
    this.capture(this.surface, event.pointerId);
  }

  private moveSteering(event: PointerEvent): void {
    if (event.pointerId !== this.steerPointer) return;
    event.preventDefault();
    const dx = event.clientX - this.origin.x;
    const dy = event.clientY - this.origin.y;
    const distance = Math.hypot(dx, dy);
    const radius = 36;
    const scale = distance > radius ? radius / distance : 1;
    const magnitude = Math.min(distance / radius, 1);
    const response = magnitude <= 0.08 ? 0 : (magnitude - 0.08) / 0.92;
    this.joystick.style.setProperty('--joystick-x', `${dx * scale}px`);
    this.joystick.style.setProperty('--joystick-y', `${dy * scale}px`);
    this.turn = distance === 0 ? 0 : (dx / distance) * response;
    this.climb = distance === 0 ? 0 : (-dy / distance) * response;
  }

  private endSteering(event: PointerEvent): void {
    if (event.pointerId !== this.steerPointer) return;
    this.steerPointer = null;
    this.turn = 0;
    this.climb = 0;
    this.joystick.classList.remove('visible');
    this.joystick.style.removeProperty('--joystick-x');
    this.joystick.style.removeProperty('--joystick-y');
  }

  private beginButton(name: ControlName, button: HTMLButtonElement, event: PointerEvent): void {
    if (!this.active() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (name === 'loop' && button.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    this.holds[name].add(event.pointerId);
    this.capture(button, event.pointerId);
    button.classList.add('is-pressed');
    button.setAttribute('aria-pressed', 'true');
  }

  private endButton(name: ControlName, button: HTMLButtonElement, event: PointerEvent, completed: boolean): void {
    if (!this.holds[name].has(event.pointerId)) return;
    this.holds[name].delete(event.pointerId);
    if (name === 'loop' && completed && this.active() && button.getAttribute('aria-disabled') !== 'true') this.loopEdge = true;
    if (this.holds[name].size === 0) {
      button.classList.remove('is-pressed');
      button.setAttribute('aria-pressed', 'false');
    }
  }

  private activateOnce(name: ControlName): void {
    if (name === 'loop') {
      if (this.buttons.loop.getAttribute('aria-disabled') !== 'true') this.loopEdge = true;
    } else {
      this.clickBursts.add(name);
    }
  }

  private keyDown(event: KeyboardEvent): void {
    if (!this.active() || event.isComposing || !SHORTCUTS.has(event.code) || this.isTypingOrActivating(event.target)) return;
    event.preventDefault();
    this.keys.add(event.code);
    if (event.code === 'KeyL' && !event.repeat && this.buttons.loop.getAttribute('aria-disabled') !== 'true') this.loopEdge = true;
  }

  private keyUp(event: KeyboardEvent): void {
    this.keys.delete(event.code);
  }

  private isTypingOrActivating(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || Boolean(target.closest('input, textarea, select, button, a, [role="dialog"]'));
  }

  private capture(element: HTMLElement, pointer: number): void {
    try { element.setPointerCapture(pointer); } catch { /* The pointer may already have been released. */ }
  }

  private releaseCapture(element: HTMLElement, pointer: number): void {
    try {
      if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
    } catch { /* Capture can be lost during a blur or page transition. */ }
  }
}
