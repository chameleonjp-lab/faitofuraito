import type { GameEvent } from './types';

const MAX_EFFECT_SOURCES = 10;
const DAMAGE_SOURCE_RESERVE = 3;
const MAX_REMEMBERED_EVENTS = 256;
const FINISH_TAIL_SECONDS = 0.45;
const KILL_TAIL_SECONDS = 0.4;

type EffectType = 'shot' | 'hit' | 'kill' | 'damage' | 'loop';

interface EffectVoice {
  type: EffectType;
  priority: number;
  sources: Set<AudioScheduledSourceNode>;
  nodes: Set<AudioNode>;
  ended: boolean;
}

const EFFECT_PRIORITY: Record<EffectType, number> = {
  shot: 1,
  hit: 2,
  loop: 2,
  kill: 3,
  damage: 4,
};

const RATE_LIMIT_SECONDS: Partial<Record<EffectType, number>> = {
  shot: 0.035,
  hit: 0.045,
  damage: 0.11,
};

const PLAYER_EFFECTS = new Set<GameEvent['type']>([
  'shot',
  'hit',
  'kill',
  'damage',
  'loop',
]);

export class FlightAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engine: OscillatorNode[] = [];
  private engineNodes: AudioNode[] = [];
  private sources = new Set<AudioScheduledSourceNode>();
  private voices = new Set<EffectVoice>();
  private noise: AudioBuffer | null = null;
  private seenEventIds = new Set<number>();
  private seenEventOrder: number[] = [];
  private lastEventAt = new Map<EffectType, number>();
  private unlockRequest: Promise<void> | null = null;
  private finishing = false;

  enabled = true;
  active = false;
  failed = false;

  get activeEffectSourceCount(): number {
    return this.sources.size;
  }

  get activeEffectVoiceCount(): number {
    return this.voices.size;
  }

  async unlock(): Promise<void> {
    if (!this.enabled) return;
    if (this.unlockRequest) return this.unlockRequest;

    const request = this.tryUnlock();
    this.unlockRequest = request;
    try {
      await request;
    } finally {
      if (this.unlockRequest === request) this.unlockRequest = null;
    }
  }

  private async tryUnlock(): Promise<void> {
    try {
      if (this.ctx?.state === 'closed') this.clearClosedContext();
      if (!this.ctx) this.createContext();
      const ctx = this.ctx;
      if (!ctx) return;

      await ctx.resume();
      if (ctx !== this.ctx) return;

      this.failed = ctx.state !== 'running';
      this.sync();
    } catch {
      this.failed = true;
    }
  }

  private createContext(): void {
    const ctx = new AudioContext();
    try {
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      const engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineGain.connect(master);

      const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.4), ctx.sampleRate);
      const data = noise.getChannelData(0);
      let seed = 47;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        data[i] = (seed >>> 0) / 2147483648 - 1;
      }

      this.ctx = ctx;
      this.master = master;
      this.engineGain = engineGain;
      this.noise = noise;
    } catch (error) {
      void ctx.close().catch(() => undefined);
      throw error;
    }
  }

  private clearClosedContext(): void {
    this.stopAllEffects(0);
    this.stopEngine(0);
    this.ctx = null;
    this.master = null;
    this.engineGain = null;
    this.noise = null;
    this.finishing = false;
  }

  sync(): void {
    const ctx = this.ctx;
    const master = this.master;
    const engineGain = this.engineGain;
    if (!ctx || !master || !engineGain || ctx.state === 'closed') return;

    const now = ctx.currentTime;
    const shouldPlay = this.enabled && this.active && ctx.state === 'running';
    this.finishing = false;

    if (!shouldPlay) {
      this.stopAllEffects(now);
      this.stopEngine(now);
      engineGain.gain.cancelScheduledValues(now);
      engineGain.gain.setValueAtTime(0, now);
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(0, now);
      return;
    }

    this.ensureEngine(now);
    engineGain.gain.cancelScheduledValues(now);
    engineGain.gain.setTargetAtTime(0.095, now, 0.035);
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(0.6, now, 0.04);
  }

  update(speed: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.engine.forEach((oscillator, index) => {
      oscillator.frequency.setTargetAtTime((40 + speed * 0.13) * (index + 1), ctx.currentTime, 0.15);
    });
  }

  event(event: GameEvent, playerEvent: boolean): void {
    if (!playerEvent || !PLAYER_EFFECTS.has(event.type)) return;
    if (!this.rememberEvent(event.id)) return;

    const type = event.type as EffectType;
    const ctx = this.ctx;
    if (!this.enabled || !this.active || !ctx || ctx.state !== 'running' || !this.master) return;

    const now = ctx.currentTime;
    const rateLimit = RATE_LIMIT_SECONDS[type];
    const lastAt = this.lastEventAt.get(type);
    if (rateLimit !== undefined && lastAt !== undefined && now - lastAt < rateLimit) return;

    const sourceCost = this.sourceCost(type);
    if (!this.reserveCapacity(type, sourceCost, now)) return;

    const voice: EffectVoice = {
      type,
      priority: EFFECT_PRIORITY[type],
      sources: new Set(),
      nodes: new Set(),
      ended: false,
    };
    this.voices.add(voice);

    try {
      switch (type) {
        case 'shot':
          this.createNoisePulse(voice, now, 1800, 1.3, 0.07, 0.05, 0.07);
          break;
        case 'hit':
          this.createHitRing(voice, now);
          break;
        case 'kill':
          this.createNoisePulse(voice, now, 550, 0.65, 0.16, 0.38, KILL_TAIL_SECONDS);
          break;
        case 'damage':
          this.createDamageAlarm(voice, now);
          break;
        case 'loop':
          this.createNoisePulse(voice, now, 1000, 1.3, 0.16, 0.12, 0.14);
          break;
      }
      this.lastEventAt.set(type, now);
    } catch {
      this.retireVoice(voice, now);
    }
  }

  /** Clear per-flight event IDs and stop every sound before a fresh run begins. */
  resetFlight(): void {
    this.active = false;
    this.finishing = false;
    this.seenEventIds.clear();
    this.seenEventOrder.length = 0;
    this.lastEventAt.clear();

    const now = this.ctx?.currentTime ?? 0;
    this.stopAllEffects(now);
    this.stopEngine(now);
    if (this.ctx && this.master && this.engineGain) {
      this.engineGain.gain.cancelScheduledValues(now);
      this.engineGain.gain.setValueAtTime(0, now);
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(0, now);
    }
  }

  /** Stop new flight audio while allowing the last critical effect to decay. */
  finishFlight(): void {
    this.active = false;
    const ctx = this.ctx;
    const master = this.master;
    const engineGain = this.engineGain;
    if (!ctx || !master || !engineGain || ctx.state !== 'running' || !this.enabled) {
      this.finishing = false;
      const now = ctx?.currentTime ?? 0;
      this.stopAllEffects(now);
      this.stopEngine(now);
      if (master && engineGain) {
        engineGain.gain.cancelScheduledValues(now);
        engineGain.gain.setValueAtTime(0, now);
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(0, now);
      }
      return;
    }

    const now = ctx.currentTime;
    this.finishing = true;
    this.stopEngine(now);
    engineGain.gain.cancelScheduledValues(now);
    engineGain.gain.setValueAtTime(0, now);
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(0.6, now);
    master.gain.setValueAtTime(0.6, now + FINISH_TAIL_SECONDS - 0.06);
    master.gain.linearRampToValueAtTime(0, now + FINISH_TAIL_SECONDS);
  }

  private rememberEvent(id: number): boolean {
    if (this.seenEventIds.has(id)) return false;
    this.seenEventIds.add(id);
    this.seenEventOrder.push(id);
    if (this.seenEventOrder.length > MAX_REMEMBERED_EVENTS) {
      const expired = this.seenEventOrder.shift();
      if (expired !== undefined) this.seenEventIds.delete(expired);
    }
    return true;
  }

  private sourceCost(type: EffectType): number {
    if (type === 'hit') return 2;
    if (type === 'damage') return 3;
    return 1;
  }

  private reserveCapacity(type: EffectType, cost: number, now: number): boolean {
    const limit = type === 'damage' ? MAX_EFFECT_SOURCES : MAX_EFFECT_SOURCES - DAMAGE_SOURCE_RESERVE;
    if (this.sources.size + cost <= limit) return true;

    const candidates = Array.from(this.voices)
      .filter(voice => voice.priority < EFFECT_PRIORITY[type])
      .sort((a, b) => a.priority - b.priority);
    for (const candidate of candidates) {
      this.retireVoice(candidate, now);
      if (this.sources.size + cost <= limit) return true;
    }
    return this.sources.size + cost <= limit;
  }

  private ensureEngine(now: number): void {
    if (this.engine.length > 0 || !this.ctx || !this.engineGain) return;

    try {
      for (const [index, frequency] of [49, 98, 147].entries()) {
        const oscillator = this.ctx.createOscillator();
        const partial = this.ctx.createGain();
        oscillator.type = index === 0 ? 'sawtooth' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, now);
        partial.gain.value = [0.45, 0.2, 0.12][index];
        oscillator.connect(partial);
        partial.connect(this.engineGain);
        this.engine.push(oscillator);
        this.engineNodes.push(oscillator, partial);
        oscillator.start(now);
      }
    } catch {
      this.stopEngine(now);
      this.failed = true;
    }
  }

  private stopEngine(now: number): void {
    for (const oscillator of this.engine) {
      try {
        oscillator.stop(now);
      } catch {
        // An oscillator may not have started or may already have ended.
      }
    }
    for (const node of this.engineNodes) {
      try {
        node.disconnect();
      } catch {
        // A node may already be disconnected.
      }
    }
    this.engine.length = 0;
    this.engineNodes.length = 0;
  }

  private createNoisePulse(
    voice: EffectVoice,
    now: number,
    cutoff: number,
    playbackRate: number,
    peak: number,
    decay: number,
    stopAt: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    const noise = this.noise;
    if (!ctx || !master || !noise) return;

    const source = this.trackSource(voice, ctx.createBufferSource());
    const filter = this.trackNode(voice, ctx.createBiquadFilter());
    const envelope = this.trackNode(voice, ctx.createGain());
    source.buffer = noise;
    source.playbackRate.setValueAtTime(playbackRate, now);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, now);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(peak, now + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(master);
    source.start(now);
    source.stop(now + stopAt);
  }

  private createHitRing(voice: EffectVoice, now: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const envelope = this.trackNode(voice, ctx.createGain());
    const partialSettings = [
      { frequency: 1760, amplitude: 0.72 },
      { frequency: 2890, amplitude: 0.38 },
    ];
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(0.14, now + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.103);
    envelope.connect(master);

    for (const setting of partialSettings) {
      const oscillator = this.trackSource(voice, ctx.createOscillator());
      const partial = this.trackNode(voice, ctx.createGain());
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(setting.frequency, now);
      partial.gain.value = setting.amplitude;
      oscillator.connect(partial);
      partial.connect(envelope);
      oscillator.start(now);
      oscillator.stop(now + 0.11);
    }
  }

  private createDamageAlarm(voice: EffectVoice, now: number): void {
    const ctx = this.ctx;
    const master = this.master;
    const noise = this.noise;
    if (!ctx || !master || !noise) return;

    const noiseSource = this.trackSource(voice, ctx.createBufferSource());
    const lowPass = this.trackNode(voice, ctx.createBiquadFilter());
    const noiseGain = this.trackNode(voice, ctx.createGain());
    noiseSource.buffer = noise;
    noiseSource.playbackRate.setValueAtTime(1, now);
    lowPass.type = 'lowpass';
    lowPass.frequency.setValueAtTime(420, now);
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.linearRampToValueAtTime(0.12, now + 0.004);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.205);
    noiseSource.connect(lowPass);
    lowPass.connect(noiseGain);
    noiseGain.connect(master);
    noiseSource.start(now);
    noiseSource.stop(now + 0.225);

    const bass = this.trackSource(voice, ctx.createOscillator());
    const bassGain = this.trackNode(voice, ctx.createGain());
    bass.type = 'sine';
    bass.frequency.setValueAtTime(108, now);
    bass.frequency.exponentialRampToValueAtTime(58, now + 0.205);
    bassGain.gain.setValueAtTime(0.0001, now);
    bassGain.gain.linearRampToValueAtTime(0.16, now + 0.006);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.225);
    bass.connect(bassGain);
    bassGain.connect(master);
    bass.start(now);
    bass.stop(now + 0.225);

    const warning = this.trackSource(voice, ctx.createOscillator());
    const warningGain = this.trackNode(voice, ctx.createGain());
    warning.type = 'sine';
    warning.frequency.setValueAtTime(660, now);
    warning.frequency.linearRampToValueAtTime(410, now + 0.12);
    warningGain.gain.setValueAtTime(0.0001, now);
    warningGain.gain.linearRampToValueAtTime(0.08, now + 0.003);
    warningGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
    warning.connect(warningGain);
    warningGain.connect(master);
    warning.start(now);
    warning.stop(now + 0.18);
  }

  private trackSource<T extends AudioScheduledSourceNode>(voice: EffectVoice, source: T): T {
    voice.sources.add(source);
    voice.nodes.add(source);
    this.sources.add(source);
    source.onended = () => this.sourceEnded(voice, source);
    return source;
  }

  private trackNode<T extends AudioNode>(voice: EffectVoice, node: T): T {
    voice.nodes.add(node);
    return node;
  }

  private sourceEnded(voice: EffectVoice, source: AudioScheduledSourceNode): void {
    if (voice.ended) return;
    this.sources.delete(source);
    voice.sources.delete(source);
    if (voice.sources.size === 0) this.retireVoice(voice);
  }

  private retireVoice(voice: EffectVoice, now = this.ctx?.currentTime ?? 0): void {
    if (voice.ended) return;
    voice.ended = true;
    this.voices.delete(voice);
    for (const source of voice.sources) {
      this.sources.delete(source);
      source.onended = null;
      try {
        source.stop(now);
      } catch {
        // Stopping an unstarted or ended source is allowed to fail harmlessly.
      }
    }
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch {
        // Disconnecting a node more than once is harmless.
      }
    }
    voice.sources.clear();
    voice.nodes.clear();
  }

  private stopAllEffects(now: number): void {
    for (const voice of Array.from(this.voices)) this.retireVoice(voice, now);
  }

  dispose(): void {
    const ctx = this.ctx;
    this.active = false;
    this.finishing = false;
    this.stopAllEffects(ctx?.currentTime ?? 0);
    this.stopEngine(ctx?.currentTime ?? 0);
    this.seenEventIds.clear();
    this.seenEventOrder.length = 0;
    this.lastEventAt.clear();
    this.ctx = null;
    this.master = null;
    this.engineGain = null;
    this.noise = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  }
}
