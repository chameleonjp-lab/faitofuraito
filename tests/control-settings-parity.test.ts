import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlSettings } from '../src/control-settings';

const names = ['fire', 'loop', 'throttle'] as const;
function style() {
  const values = new Map<string, string>();
  return { values, setProperty: (key: string, value: string) => values.set(key, value) };
}

test('landscape display and preview use the same capped size without changing saved layout', () => {
  for (const [width, height] of [[393, 852], [620, 320], [620, 393]]) {
    const layout = Object.fromEntries(names.map(name => [name, { x: .95, y: .95, size: 140, opacity: .8 }]));
    const buttons = Object.fromEntries(names.map(name => [name, { style: style(), setAttribute() {}, classList: { toggle() {} } }]));
    const previewButtons = Object.fromEntries(names.map(name => [name, { style: style(), dataset: {}, hidden: false, setAttribute() {}, classList: { toggle() {} } }]));
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

test('settings preview uses clean labelled buttons without runtime IDs or control state', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const nodes: any[] = [];
  const createElement = (tagName: string) => ({
    tagName, type: '', textContent: '', dataset: {}, attributes: new Map<string, string>(), children: [] as any[],
    classList: { add() {} }, append(child: any) { this.children.push(child); },
    setAttribute(name: string, value: string) { this.attributes.set(name, value); },
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement } });
  const settings = Object.assign(Object.create(ControlSettings.prototype), {
    preview: { replaceChildren() {}, append: (node: any) => nodes.push(node) },
  });
  try {
    settings.buildPreviewButtons();
    assert.equal(nodes.length, 3);
    assert.deepEqual(nodes.map(node => node.dataset.control), names);
    assert.deepEqual(nodes.map(node => node.children[0].textContent), ['射撃', '宙返り', '速度レバー']);
    for (const node of nodes) {
      assert.equal(node.tagName, 'button');
      assert.equal(node.type, 'button');
      assert.equal(node.attributes.get('aria-hidden'), 'true');
      assert.equal(node.attributes.has('id'), false);
      assert.equal(node.attributes.has('aria-pressed'), false);
      assert.equal(node.attributes.has('aria-disabled'), false);
      assert.equal(node.tabIndex, -1);
      assert.equal(node.children[0].attributes.has('id'), false);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
