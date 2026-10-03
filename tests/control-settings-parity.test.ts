import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlSettings } from '../src/control-settings';

const names = ['fire', 'loop', 'accelerate', 'brake'] as const;
function style() {
  const values = new Map<string, string>();
  return { values, setProperty: (key: string, value: string) => values.set(key, value) };
}

test('landscape display and preview use the same capped size without changing saved layout', () => {
  for (const [width, height] of [[393, 852], [620, 320], [620, 393]]) {
    const layout = Object.fromEntries(names.map(name => [name, { x: .95, y: .95, size: 140, opacity: .8 }]));
    const buttons = Object.fromEntries(names.map(name => [name, { style: style() }]));
    const previewButtons = Object.fromEntries(names.map(name => [name, { style: style(), hidden: false, classList: { toggle() {} } }]));
    const scale = .35;
    const settings = Object.assign(Object.create(ControlSettings.prototype), {
      app: { getBoundingClientRect: () => ({ width, height }) }, buttons,
      draft: { normal: layout, easy: layout }, layoutMode: 'normal', selected: 'fire',
      readInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
      preview: { getBoundingClientRect: () => ({ width: width * scale, height: height * scale }), querySelector: (selector: string) => previewButtons[names.find(name => selector.includes(`"${name}"`))!] },
    });
    const before = JSON.stringify(layout);
    settings.apply(layout, 'normal');
    settings.stylePreviewButtons();
    const expected = width > height ? Math.min(140, Math.max(44, height * .16)) : 140;
    for (const name of names) {
      assert.equal(buttons[name].style.values.get('--control-size'), `${expected}px`);
      assert.equal(previewButtons[name].style.values.get('--control-size'), `${expected * scale}px`);
      for (const key of ['--control-x', '--control-y']) assert.equal(buttons[name].style.values.get(key), previewButtons[name].style.values.get(key));
    }
    assert.equal(JSON.stringify(layout), before);
  }
});

test('settings preview removes descendant IDs and active control attributes', () => {
  const clones: any[] = [];
  const buttons = Object.fromEntries(names.map(name => [name, { cloneNode() {
    const child = { removed: [] as string[], removeAttribute(key: string) { this.removed.push(key); } };
    return { child, removed: [] as string[], removeAttribute(key: string) { this.removed.push(key); }, querySelectorAll: () => [child], dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {} };
  } }]));
  const settings = Object.assign(Object.create(ControlSettings.prototype), { buttons, preview: { replaceChildren() {}, append: (clone: any) => clones.push(clone) } });
  settings.buildPreviewButtons();
  assert.equal(clones.length, 4);
  for (const clone of clones) {
    assert.deepEqual(clone.removed, ['id', 'aria-pressed', 'aria-disabled']);
    assert.deepEqual(clone.child.removed, ['id']);
    assert.equal(clone.tabIndex, -1);
  }
});
