import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlSettings, DEFAULT_LAYOUT, persistControlSettings, previewDimensions, previewLabelStyle } from '../src/control-settings';
import { DEFAULT_KEY_BINDINGS, KeyboardSettings, KEYBOARD_STORAGE_KEY } from '../src/keyboard-settings';

const normalKey = 'faitofuraito-controls-v1';
const easyKey = 'faitofuraito-controls-easy-v1';
const copyLayout = () => structuredClone(DEFAULT_LAYOUT);

function storage(initial: Array<[string, string]> = [], failKey?: string) {
  const values = new Map(initial);
  const writes: string[] = [];
  return {
    values, writes,
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) {
      writes.push(key);
      if (key === failKey) throw new Error('Storage denied');
      values.set(key, value);
    },
    removeItem(key: string) { values.delete(key); },
  };
}

function replaceGlobal(name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  };
}

test('settings persistence restores prior values after partial write and refuses newer formats', () => {
  const oldLayout = JSON.stringify({ version: 1, controls: copyLayout() });
  const st = storage([[normalKey, oldLayout]], KEYBOARD_STORAGE_KEY);
  assert.equal(persistControlSettings([
    { key: normalKey, value: 'new layout' },
    { key: easyKey, value: 'new easy layout' },
    { key: KEYBOARD_STORAGE_KEY, value: 'new keys' },
  ], st), false);
  assert.deepEqual([...st.values], [[normalKey, oldLayout]]);
  const future = storage([[KEYBOARD_STORAGE_KEY, '{"version":2,"bindings":{}}']]);
  assert.equal(persistControlSettings([
    { key: normalKey, value: oldLayout }, { key: KEYBOARD_STORAGE_KEY, value: 'new keys' },
  ], future), false);
  assert.deepEqual(future.writes, [], 'future format check happens before any writes');
  const deniedRead = { ...st, getItem() { throw new Error('Storage read denied'); } };
  assert.equal(persistControlSettings([{ key: normalKey, value: oldLayout }], deniedRead), false);
});

test('failed save preserves active settings until session-only use is explicitly selected', () => {
  const st = storage([], KEYBOARD_STORAGE_KEY);
  const restore = replaceGlobal('localStorage', st);
  const keyboard = new KeyboardSettings();
  const saved = { normal: copyLayout(), easy: copyLayout() };
  const draft = structuredClone(saved);
  draft.normal.fire.x = .63;
  const keyDraft = { ...DEFAULT_KEY_BINDINGS, fire: 'KeyF' };
  const note = { textContent: '', hidden: true, scrollIntoView() {} };
  const saveButton = { textContent: '保存する' };
  const closed: string[] = [];
  let applied = 0;
  const settings = Object.assign(Object.create(ControlSettings.prototype), {
    keyboard, saved, draft, keyDraft, activeMode: 'normal', allowedModes: ['normal'],
    capturing: null, saveFailedAwaitingUse: false, storageUnavailable: false,
    apply() { applied++; },
    dialog: {
      close(value: string) { closed.push(value); },
      querySelector(selector: string) { return selector === '#control-save' ? saveButton : note; },
    },
  });
  try {
    settings.save();
    assert.equal(keyboard.code('fire'), 'Space');
    assert.equal(settings.saved.normal.fire.x, DEFAULT_LAYOUT.fire.x);
    assert.equal(applied, 0);
    assert.deepEqual(closed, []);
    assert.deepEqual([...st.values], [], 'successful touch write is rolled back after key write fails');
    assert.equal(saveButton.textContent, '今回だけ使う');
    assert.equal(note.hidden, false);
    const writes = st.writes.length;
    settings.save();
    assert.equal(keyboard.code('fire'), 'KeyF');
    assert.equal(settings.saved.normal.fire.x, .63);
    assert.equal(applied, 1);
    assert.deepEqual(closed, ['session-only']);
    assert.equal(st.writes.length, writes, 'session-only confirmation does not retry storage');
  } finally { restore(); }
});

class ElementStub extends EventTarget {
  values = new Map<string, string>();
  style = { setProperty: (key: string, value: string) => this.values.set(key, value) };
  attributes = new Map<string, string>();
  children: ElementStub[] = [];
  queries = new Map<string, ElementStub>();
  classList = { add() {}, remove() {}, toggle() {} };
  options: unknown[] = [];
  open = false;
  innerHTML = '';
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  append(child: ElementStub) { this.children.push(child); }
  remove() {}
  getBoundingClientRect() { return { width: 393, height: 852 }; }
  querySelector(selector: string) {
    if (!this.queries.has(selector)) this.queries.set(selector, new ElementStub());
    return this.queries.get(selector)!;
  }
}

test('constructor loads existing FightFlight v1 layouts unchanged and ignores other game settings', () => {
  const normal = copyLayout(); normal.fire = { x: .62, y: .54, size: 112, opacity: .42 };
  const easy = copyLayout(); easy.loop = { x: .74, y: .58, size: 92, opacity: .61 };
  const st = storage([
    [normalKey, JSON.stringify({ version: 1, controls: normal })],
    [easyKey, JSON.stringify({ version: 1, controls: easy })],
    ['kaisen-keyboard-v1', JSON.stringify({ version: 1, bindings: { ...DEFAULT_KEY_BINDINGS, fire: 'KeyF' } })],
  ]);
  const app = new ElementStub();
  const restores = [
    replaceGlobal('localStorage', st),
    replaceGlobal('window', Object.assign(new EventTarget(), { visualViewport: new EventTarget() })),
    replaceGlobal('document', Object.assign(new EventTarget(), { getElementById: () => app, createElement: () => new ElementStub() })),
    replaceGlobal('getComputedStyle', () => ({ paddingTop: '0', paddingRight: '0', paddingBottom: '0', paddingLeft: '0' })),
    replaceGlobal('ResizeObserver', class { observe() {} disconnect() {} }),
  ];
  const keyboard = new KeyboardSettings();
  const buttons = Object.fromEntries(Object.keys(DEFAULT_LAYOUT).map(name => [name, new ElementStub()]));
  let settings: ControlSettings | undefined;
  try {
    settings = new ControlSettings(buttons as any, keyboard);
    assert.deepEqual((settings as any).saved, { normal, easy });
    assert.equal(buttons.fire.values.get('--control-x'), '62%');
    settings.setActiveMode('easy');
    assert.equal(buttons.loop.values.get('--control-size'), '92px');
    assert.equal(keyboard.code('fire'), 'Space');
    assert.deepEqual(st.writes, [], 'opening settings never rewrites existing saves');
  } finally {
    settings?.dispose();
    for (const restore of restores.reverse()) restore();
  }
});

test('full preview fits either orientation and small buttons keep readable labels', () => {
  for (const [width, height, availableWidth, availableHeight] of [[393, 852, 320, 360], [852, 393, 600, 160], [320, 568, 260, 110]]) {
    const preview = previewDimensions(width, height, availableWidth, availableHeight);
    assert.ok(preview.width <= availableWidth);
    assert.ok(preview.height <= availableHeight);
    assert.ok(Math.abs(preview.width / preview.height - width / height) < 1e-12);
  }
  assert.deepEqual(previewLabelStyle(20, 3), { outside: true, fontSize: 10 });
  assert.deepEqual(previewLabelStyle(72, 3), { outside: false, fontSize: 13 });
});
