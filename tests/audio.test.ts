import assert from 'node:assert/strict';
import test from 'node:test';
import { FlightAudio } from '../src/audio';
import type { GameEvent } from '../src/types';

interface ParamEvent {
  type: string;
  value: number;
  time: number;
}

class FakeAudioParam {
  value = 0;
  readonly events: ParamEvent[] = [];

  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ type: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'exponential', value, time });
    return this;
  }

  setTargetAtTime(value: number, time: number, constant: number): this {
    this.events.push({ type: `target:${constant}`, value, time });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events.push({ type: 'cancel', value: this.value, time });
    return this;
  }
}

class FakeAudioNode {
  readonly connections: FakeAudioNode[] = [];
  disconnectCount = 0;

  connect(destination: FakeAudioNode): FakeAudioNode {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnectCount += 1;
    this.connections.length = 0;
  }
}

class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

class FakeBiquadFilterNode extends FakeAudioNode {
  type = 'lowpass';
  readonly frequency = new FakeAudioParam();
}

abstract class FakeScheduledSource extends FakeAudioNode {
  onended: (() => void) | null = null;
  startAt: number | null = null;
  stopAt: number | null = null;
  readonly stopCalls: number[] = [];
  ended = false;

  start(when = 0): void {
    this.startAt = when;
  }

  stop(when = 0): void {
    this.stopAt = when;
    this.stopCalls.push(when);
  }

  finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.onended?.();
  }
}

class FakeOscillatorNode extends FakeScheduledSource {
  type = 'sine';
  readonly frequency = new FakeAudioParam();
}

class FakeBufferSourceNode extends FakeScheduledSource {
  buffer: FakeAudioBuffer | null = null;
  readonly playbackRate = new FakeAudioParam();
}

class FakeAudioBuffer {
  private readonly channel: Float32Array;

  constructor(length: number) {
    this.channel = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.channel;
  }
}

class FakeAudioContext {
  static latest: FakeAudioContext | null = null;

  state: AudioContextState = 'suspended';
  currentTime = 0;
  readonly sampleRate = 44100;
  readonly destination = new FakeAudioNode();
  readonly oscillators: FakeOscillatorNode[] = [];
  readonly bufferSources: FakeBufferSourceNode[] = [];
  readonly filters: FakeBiquadFilterNode[] = [];
  readonly gains: FakeGainNode[] = [];

  constructor() {
    FakeAudioContext.latest = this;
  }

  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  }

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode();
    this.oscillators.push(node);
    return node;
  }

  createBufferSource(): FakeBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.bufferSources.push(node);
    return node;
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    const node = new FakeBiquadFilterNode();
    this.filters.push(node);
    return node;
  }

  createBuffer(_channels: number, length: number): FakeAudioBuffer {
    return new FakeAudioBuffer(length);
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const source of [...this.oscillators, ...this.bufferSources]) {
      if (source.stopAt !== null && source.stopAt <= this.currentTime) source.finish();
    }
  }
}

function installFakeAudioContext(): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    writable: true,
    value: FakeAudioContext,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'AudioContext', previous);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  };
}

async function createFixture(): Promise<{
  audio: FlightAudio;
  context: FakeAudioContext;
  restore: () => void;
}> {
  const restore = installFakeAudioContext();
  const audio = new FlightAudio();
  audio.active = true;
  await audio.unlock();
  const context = FakeAudioContext.latest;
  assert.ok(context);
  return { audio, context, restore };
}

function gameEvent(id: number, type: GameEvent['type']): GameEvent {
  return { id, type, position: {} as GameEvent['position'], owner: 1 };
}

function rememberedIds(audio: FlightAudio): Set<number> {
  return Reflect.get(audio, 'seenEventIds') as Set<number>;
}

test('only player-owned events sound, and duplicate IDs do not replay', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    const eventTypes: GameEvent['type'][] = ['shot', 'hit', 'kill', 'damage', 'loop'];
    eventTypes.forEach((type, index) => audio.event(gameEvent(index + 1, type), false));
    assert.equal(audio.activeEffectSourceCount, 0);

    const hit = gameEvent(10, 'hit');
    audio.event(hit, true);
    audio.event(hit, true);
    assert.equal(audio.activeEffectSourceCount, 2);
    assert.equal(context.oscillators.filter(node => node.startAt === 0).length, 5);
  } finally {
    audio.dispose();
    restore();
  }
});

test('shot and hit voices respect their separate minimum intervals', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    audio.event(gameEvent(1, 'shot'), true);
    context.currentTime = 0.02;
    audio.event(gameEvent(2, 'shot'), true);
    assert.equal(audio.activeEffectSourceCount, 1, 'shots inside 35 ms are suppressed');
    context.currentTime = 0.036;
    audio.event(gameEvent(3, 'shot'), true);
    assert.equal(audio.activeEffectSourceCount, 2);

    audio.event(gameEvent(4, 'hit'), true);
    assert.equal(audio.activeEffectSourceCount, 4);
    context.currentTime = 0.08;
    audio.event(gameEvent(5, 'hit'), true);
    assert.equal(audio.activeEffectSourceCount, 4, 'hits inside 45 ms are suppressed');
    context.currentTime = 0.086;
    audio.event(gameEvent(6, 'hit'), true);
    assert.equal(audio.activeEffectSourceCount, 6);
  } finally {
    audio.dispose();
    restore();
  }
});

test('hit is a short metallic ring and player damage uses a low warning blend', async () => {
  const hitFixture = await createFixture();
  try {
    hitFixture.audio.event(gameEvent(1, 'hit'), true);
    const ring = hitFixture.context.oscillators.filter(node =>
      [1760, 2890].includes(node.frequency.value),
    );
    assert.equal(ring.length, 2);
    assert.deepEqual(ring.map(node => node.frequency.value).sort((a, b) => a - b), [1760, 2890]);
    assert.ok(ring.every(node => node.type === 'sine'));
    assert.ok(ring.every(node => node.startAt !== null && node.stopAt !== null && node.stopAt - node.startAt < 0.12));
  } finally {
    hitFixture.audio.dispose();
    hitFixture.restore();
  }

  const damageFixture = await createFixture();
  try {
    damageFixture.audio.event(gameEvent(2, 'damage'), true);
    const damageTones = damageFixture.context.oscillators.filter(node => [108, 660].includes(node.frequency.value));
    assert.equal(damageTones.length, 2);
    assert.ok(damageTones[0].frequency.events.some(event => event.type === 'exponential' && event.value === 58));
    assert.ok(damageTones[1].frequency.events.some(event => event.type === 'linear' && event.value === 410));
    assert.equal(damageFixture.context.filters.at(-1)?.frequency.value, 420);

    const damageSources = [
      ...damageFixture.context.bufferSources.slice(-1),
      ...damageTones,
    ];
    const longest = Math.max(...damageSources.map(source => source.stopAt! - source.startAt!));
    assert.equal(longest, 0.225);
  } finally {
    damageFixture.audio.dispose();
    damageFixture.restore();
  }
});

test('effect sources stay bounded, reserve three slots for damage, and rate-limit repeats', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    for (let id = 1; id <= 7; id++) audio.event(gameEvent(id, 'kill'), true);
    assert.equal(audio.activeEffectSourceCount, 7);

    audio.event(gameEvent(20, 'shot'), true);
    assert.equal(audio.activeEffectSourceCount, 7, 'low-priority effects cannot consume the damage reserve');

    audio.event(gameEvent(21, 'damage'), true);
    assert.equal(audio.activeEffectSourceCount, 10);
    const firstDamageCount = audio.activeEffectSourceCount;

    audio.event(gameEvent(22, 'damage'), true);
    assert.equal(audio.activeEffectSourceCount, firstDamageCount, 'damage events inside 110 ms are suppressed');

    context.currentTime = 0.13;
    audio.event(gameEvent(23, 'damage'), true);
    assert.equal(audio.activeEffectSourceCount, 10);
    assert.ok(
      context.bufferSources.filter(node => node.stopCalls.length > 1).length >= 3,
      'a high-priority damage cue retires lower-priority kill voices when the cap is full',
    );

    for (let id = 100; id < 400; id++) audio.event(gameEvent(id, 'kill'), true);
    assert.equal(audio.activeEffectSourceCount, 10);
    assert.equal(rememberedIds(audio).size, 256);
  } finally {
    audio.dispose();
    restore();
  }
});

test('mute stops active sounds immediately, while finish lets the final damage decay and cleans up', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    audio.event(gameEvent(1, 'shot'), true);
    const shot = context.bufferSources.at(-1);
    assert.ok(shot);
    audio.enabled = false;
    audio.sync();
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(shot.stopAt, context.currentTime);
    assert.equal(context.oscillators.slice(0, 3).every(node => node.stopAt === context.currentTime), true);

    audio.enabled = true;
    await audio.unlock();
    audio.event(gameEvent(2, 'damage'), true);
    assert.equal(audio.activeEffectSourceCount, 3);
    audio.finishFlight();
    assert.equal(audio.activeEffectSourceCount, 3, 'finish does not cut off the scheduled damage cue');
    assert.equal(audio.active, false);
    assert.equal(context.oscillators.slice(-5, -2).every(node => node.stopAt === context.currentTime), true);
    assert.ok(context.gains[0].gain.events.some(event => event.type === 'linear' && event.value === 0 && event.time === 0.45));

    audio.event(gameEvent(3, 'hit'), true);
    assert.equal(audio.activeEffectSourceCount, 3, 'finished flight rejects new sounds');
    context.advance(0.23);
    assert.equal(audio.activeEffectSourceCount, 0);
    assert.equal(audio.activeEffectVoiceCount, 0);
  } finally {
    audio.dispose();
    restore();
  }
});

test('event dedupe is bounded and a new flight resets the event ID window', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    for (let id = 1; id <= 300; id++) audio.event(gameEvent(id, 'kill'), true);
    assert.equal(rememberedIds(audio).size, 256);

    audio.resetFlight();
    assert.equal(audio.activeEffectSourceCount, 0);
    audio.active = true;
    audio.sync();
    audio.event(gameEvent(1, 'hit'), true);
    assert.equal(audio.activeEffectSourceCount, 2, 'IDs from a prior game cannot suppress a new game');
    assert.equal(context.state, 'running');
  } finally {
    audio.dispose();
    restore();
  }
});
