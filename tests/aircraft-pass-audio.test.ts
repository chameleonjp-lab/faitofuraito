import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { FlightAudio } from '../src/audio';
import type { Aircraft, GameEvent } from '../src/types';

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

class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan = new FakeAudioParam();
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
  loop = false;
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
  static instances = 0;
  failPanner = false;
  failBufferAfter = Infinity;

  state: AudioContextState = 'suspended';
  currentTime = 0;
  readonly sampleRate = 44100;
  readonly destination = new FakeAudioNode();
  readonly oscillators: FakeOscillatorNode[] = [];
  readonly bufferSources: FakeBufferSourceNode[] = [];
  readonly filters: FakeBiquadFilterNode[] = [];
  readonly gains: FakeGainNode[] = [];
  readonly panners: FakeStereoPannerNode[] = [];

  constructor() {
    FakeAudioContext.latest = this;
    FakeAudioContext.instances++;
  }

  createStereoPanner(): FakeStereoPannerNode {
    if (this.failPanner) throw new Error('panner creation failed');
    const node = new FakeStereoPannerNode();
    this.panners.push(node);
    return node;
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
    if (this.bufferSources.length >= this.failBufferAfter) throw new Error('buffer source creation failed');
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

function aircraft(id = 1, x = 0, y = 0, z = 0): Aircraft {
  return { id, position: new Vector3(x, y, z), quaternion: new Quaternion(), health: 80, speed: 110, age: 0 } as Aircraft;
}

function event(id: number, position = new Vector3(), extra: Partial<GameEvent> = {}): GameEvent {
  return { id, type: 'shot', owner: 100, tick: 1, mountId: 'port-1', detail: 'light-aa', position, ...extra };
}

interface InspectedVoice {
  type: string;
  ended: boolean;
  sources: Set<FakeScheduledSource>;
  nodes: Set<FakeAudioNode>;
  spatial: { pan: FakeStereoPannerNode; gain: FakeGainNode; filter: FakeBiquadFilterNode };
}

function voices(audio: FlightAudio): InspectedVoice[] {
  return Array.from(Reflect.get(audio, 'voices') as Set<InspectedVoice>);
}

function latestVoice(audio: FlightAudio): InspectedVoice {
  const voice = voices(audio).at(-1);
  assert.ok(voice);
  return voice;
}

function passStateCount(audio: FlightAudio): number {
  return (Reflect.get(audio, 'passes') as Map<number, unknown>).size;
}

function actualEffects(audio: FlightAudio, context: FakeAudioContext): FakeScheduledSource[] {
  const engine = Reflect.get(audio, 'engine') as FakeOscillatorNode[];
  return [...context.bufferSources, ...context.oscillators.filter(node => !engine.includes(node))]
    .filter(node => node.startAt !== null && !node.ended && node.stopAt !== null && node.stopAt > context.currentTime);
}

function paramLast(param: FakeAudioParam): number {
  return param.events.at(-1)!.value;
}

test('pass cues require actual approach, track real pan and Doppler through recession, and have finite per-aircraft cooldown', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    const player = aircraft();
    const passing = aircraft(2, 50, 0, -170);
    audio.updatePasses([player, passing], player, 0);
    audio.updatePasses([player, passing], player, 0.1);
    assert.equal(audio.activeEffectSourceCount, 0, 'nearby stationary formation aircraft do not fake a pass');
    passing.position.z = -140;
    context.currentTime = 0.2;
    audio.updatePasses([passing], player, 0.2);
    assert.equal(audio.activeEffectSourceCount, 2);
    const voice = latestVoice(audio);
    const tone = [...voice.sources].find(source => source instanceof FakeOscillatorNode) as FakeOscillatorNode;
    const approachPitch = paramLast(tone.frequency);
    assert.ok(approachPitch > 70 + passing.speed * 0.35);
    assert.ok(paramLast(voice.spatial.pan.pan) > 0);
    passing.position.set(-50, 0, 170);
    context.currentTime = 0.3;
    audio.updatePasses([passing], player, 0.3);
    assert.ok(paramLast(tone.frequency) < 70 + passing.speed * 0.35, 'recession lowers actual pass pitch');
    assert.ok(paramLast(voice.spatial.pan.pan) < 0, 'pan follows the moving entity');
    context.advance(1.5);
    assert.equal(audio.activeEffectSourceCount, 0);
    for (let tick = 18; tick <= 42; tick++) {
      context.currentTime = tick / 10;
      passing.position.z = tick % 2 ? -140 : -170;
      audio.updatePasses([passing], player, tick / 10);
    }
    assert.equal(context.panners.length, 1, 'repeat approach inside four seconds creates no new pass');
    passing.position.z = -140;
    context.currentTime = 4.3;
    audio.updatePasses([passing], player, 4.3);
    assert.equal(context.panners.length, 2, 'a later real approach can sound again');
    assert.equal(audio.activeEffectSourceCount, 2);
  } finally { audio.dispose(); restore(); }
});

test('pass tracking excludes dead/self aircraft, limits active voices and state, and removes replaced entities', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    const player = aircraft();
    const fleet = Array.from({ length: 50 }, (_, i) => aircraft(i + 2, 0, 0, -180 - i));
    audio.updatePasses([player, ...fleet], player, 0);
    assert.equal(passStateCount(audio), 32);
    fleet.forEach(entity => entity.position.z += 40);
    context.currentTime = 0.1;
    audio.updatePasses([player, ...fleet], player, 0.1);
    assert.equal(audio.activeEffectVoiceCount, 1, 'the global 300ms pass interval limits same-frame clusters');
    for (const tick of [4, 8]) {
      context.currentTime = tick / 10;
      fleet.forEach(entity => entity.position.z += 20);
      audio.updatePasses(fleet, player, tick / 10);
    }
    assert.equal(audio.activeEffectVoiceCount, 2);
    assert.equal(audio.activeEffectSourceCount, 4);
    assert.equal(actualEffects(audio, context).length, 4);
    fleet.forEach(entity => { entity.health = 0; });
    audio.updatePasses([player, ...fleet], player, 0.9);
    assert.equal(passStateCount(audio), 0);
    assert.equal(audio.activeEffectSourceCount, 0, 'death immediately cancels pass tails');
    const respawn = aircraft(99, 0, 0, -120);
    audio.updatePasses([respawn], player, 1);
    assert.equal(audio.activeEffectSourceCount, 0, 'a respawn gets a new motion baseline');
    respawn.position.z = -100;
    context.currentTime = 1.1;
    audio.updatePasses([respawn], player, 1.1);
    assert.equal(audio.activeEffectSourceCount, 2);
    audio.updatePasses([], player, 1.2);
    assert.equal(passStateCount(audio), 0);
    assert.equal(audio.activeEffectSourceCount, 0);
  } finally { audio.dispose(); restore(); }
});

test('rewound time, same-ID respawn and missing pass updates discard old motion without replaying a tail', async () => {
  const { audio, context, restore } = await createFixture();
  try {
    const player = aircraft();
    const passing = aircraft(2, 0, 0, -170);
    passing.age = 10;
    audio.updatePasses([passing], player, 10);
    passing.position.z = -140;
    context.currentTime = 0.1;
    audio.updatePasses([passing], player, 10.1);
    assert.equal(audio.activeEffectSourceCount, 2);
    passing.age = 0;
    audio.updatePasses([passing], player, 10.2);
    assert.equal(audio.activeEffectSourceCount, 0);
    audio.updatePasses([passing], player, 0);
    assert.equal(audio.activeEffectSourceCount, 0);
    passing.position.z = -10;
    audio.updatePasses([passing], player, 2);
    assert.equal(audio.activeEffectSourceCount, 0, 'an unobserved gap cannot synthesize a historic flyby');
  } finally { audio.dispose(); restore(); }
});

test('pass sounds stop on pause, mute, reset and finish while damage sources keep priority',async()=>{
 const {audio,context,restore}=await createFixture();
 try{
  const player=aircraft(),passing=aircraft(2,0,0,-180);
  const start=(elapsed:number)=>{
   passing.position.z=-180;audio.updatePasses([passing],player,elapsed);
   passing.position.z=-150;context.currentTime+=.1;audio.updatePasses([passing],player,elapsed+.1);
  };
  start(0);assert.equal(audio.activeEffectSourceCount,2);
  audio.active=false;audio.sync();assert.equal(audio.activeEffectSourceCount,0);assert.equal(passStateCount(audio),0);
  audio.active=true;audio.sync();start(1);assert.equal(audio.activeEffectSourceCount,2);
  audio.event({id:40,type:'damage',position:player.position,owner:player.id},true);assert.equal(audio.activeEffectSourceCount,5);
  audio.finishFlight();assert.equal(audio.activeEffectSourceCount,3);assert.equal(passStateCount(audio),0);
  context.advance(2);assert.equal(audio.activeEffectSourceCount,0);
  audio.resetFlight();audio.active=true;audio.sync();start(4);assert.equal(audio.activeEffectSourceCount,2);
  audio.enabled=false;audio.sync();assert.equal(audio.activeEffectSourceCount,0);assert.equal(passStateCount(audio),0);
  audio.enabled=true;audio.active=true;audio.sync();start(6);assert.equal(audio.activeEffectSourceCount,2);
  audio.resetFlight();assert.equal(audio.activeEffectSourceCount,0);assert.equal(passStateCount(audio),0);
 }finally{audio.dispose();restore();}
});

test('pass spatial graph failure cleans all allocations without affecting flight state',async()=>{
 const {audio,context,restore}=await createFixture();
 try{
  const player=aircraft(),passing=aircraft(2,0,0,-180);audio.updatePasses([passing],player,0);
  context.failBufferAfter=0;passing.position.z=-150;context.currentTime=.1;
  const before=JSON.stringify([player,passing]);audio.updatePasses([passing],player,.1);
  assert.equal(JSON.stringify([player,passing]),before);assert.equal(audio.activeEffectSourceCount,0);
  assert.equal(audio.activeEffectVoiceCount,0);
 }finally{audio.dispose();restore();}
});
