import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { AircraftFactory, type AircraftVisual } from './aircraft';
import type { Aircraft, GameEvent, GameMode, GameState } from './types';
import { FLIGHT_FOV, FLIGHT_FAR, getFlightCameraPose } from './flight-view';

type SceneStats = { calls: number; triangles: number; geometries: number; textures: number };
type VisualEvent = { id: number; position: Vector3; age: number; life: number; radius: number; color: Color };
type ParticleSlot = {
  active: boolean;
  position: Vector3;
  velocity: Vector3;
  age: number;
  life: number;
  size: number;
  seed: number;
  dark: boolean;
};
type SmokeEmitter = { nextAt: number; serial: number };
type WreckVisual = {
  visual: AircraftVisual;
  nextSmokeAt: number;
  nextFireAt: number;
  smokeSerial: number;
  fireSerial: number;
};

const UP = new Vector3(0, 1, 0);
const MAX_TRACERS = 192;
const MAX_EFFECTS = 36;
const MAX_PLUME_SMOKE = 144;
const MAX_WRECK_FLAMES = 36;
const WRECK_FIRE_POINTS = [
  new Vector3(0, 0.48, -3.65),
  new Vector3(-1.95, 0.08, -1.55),
  new Vector3(1.95, 0.08, -1.55),
  new Vector3(0, 0.42, 0.65),
];

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function particleSlots(count: number): ParticleSlot[] {
  return Array.from({ length: count }, () => ({
    active: false,
    position: new Vector3(),
    velocity: new Vector3(),
    age: 0,
    life: 1,
    size: 1,
    seed: 0,
    dark: false,
  }));
}

function buildSmokeTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is required to generate smoke sprites.');
  const random = rng(0x52a6c3);
  for (let i = 0; i < 12; i++) {
    const x = 28 + random() * 72;
    const y = 26 + random() * 76;
    const radius = 18 + random() * 28;
    const puff = ctx.createRadialGradient(x, y, radius * 0.04, x, y, radius);
    puff.addColorStop(0, 'rgba(255,255,255,' + (0.10 + random() * 0.10) + ')');
    puff.addColorStop(0.52, 'rgba(255,255,255,' + (0.055 + random() * 0.045) + ')');
    puff.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = puff;
    ctx.fillRect(0, 0, 128, 128);
  }
  const core = ctx.createRadialGradient(64, 65, 5, 64, 65, 54);
  core.addColorStop(0, 'rgba(255,255,255,0.30)');
  core.addColorStop(0.48, 'rgba(255,255,255,0.18)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function buildFlameTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is required to generate flame sprites.');
  const glow = ctx.createRadialGradient(64, 79, 4, 64, 75, 48);
  glow.addColorStop(0, 'rgba(255,255,255,0.98)');
  glow.addColorStop(0.30, 'rgba(255,255,255,0.82)');
  glow.addColorStop(0.66, 'rgba(255,255,255,0.32)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.moveTo(35, 111);
  ctx.bezierCurveTo(26, 88, 51, 74, 47, 43);
  ctx.bezierCurveTo(66, 56, 65, 31, 78, 18);
  ctx.bezierCurveTo(82, 52, 105, 73, 94, 100);
  ctx.bezierCurveTo(83, 120, 48, 123, 35, 111);
  ctx.closePath();
  const body = ctx.createLinearGradient(0, 24, 0, 118);
  body.addColorStop(0, 'rgba(255,255,255,0.20)');
  body.addColorStop(0.38, 'rgba(255,255,255,0.55)');
  body.addColorStop(0.78, 'rgba(255,255,255,0.95)');
  body.addColorStop(1, 'rgba(255,255,255,0.30)');
  ctx.fillStyle = body;
  ctx.fill();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function buildSky(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1536;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is required to generate the sky.');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#245b8a');
  gradient.addColorStop(0.22, '#397da8');
  gradient.addColorStop(0.43, '#72a9c2');
  gradient.addColorStop(0.52, '#b2cbd0');
  gradient.addColorStop(0.58, '#c5d3d2');
  gradient.addColorStop(0.67, '#8db5c8');
  gradient.addColorStop(0.82, '#6799b7');
  gradient.addColorStop(1, '#345f87');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const haze = ctx.createRadialGradient(1120, 425, 8, 1120, 425, 310);
  haze.addColorStop(0, 'rgba(255,244,215,0.34)');
  haze.addColorStop(0.24, 'rgba(245,228,202,0.15)');
  haze.addColorStop(1, 'rgba(226,238,236,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(760, 100, 720, 650);

  const random = rng(0x1842b7);
  for (let i = 0; i < 150; i++) {
    const x = random() * canvas.width;
    const y = 224 + random() * 205;
    const w = 28 + random() * 180;
    const h = 2 + random() * 8;
    ctx.fillStyle = 'rgba(239,247,243,' + (0.02 + random() * 0.055) + ')';
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, (random() - 0.5) * 0.11, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 72; i++) {
    const x = random() * canvas.width;
    const y = 120 + random() * 160;
    const len = 24 + random() * 128;
    ctx.strokeStyle = 'rgba(218,235,237,' + (0.025 + random() * 0.04) + ')';
    ctx.lineWidth = 1 + random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + len * 0.25, y - 3, x + len * 0.72, y + 4, x + len, y - 1);
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const CLOUD_VERTEX = [
  'varying vec3 vWorldPosition;',
  'void main() { vec4 worldPosition=modelMatrix*vec4(position,1.0); vWorldPosition=worldPosition.xyz; gl_Position=projectionMatrix*viewMatrix*worldPosition; }',
].join('\n');

const CLOUD_FRAGMENT = [
  'uniform float uTime;',
  'uniform vec3 uCamera;',
  'varying vec3 vWorldPosition;',
  'float hash3(vec3 p) { p=fract(p*0.1031); p+=dot(p,p.yxz+33.33); return fract((p.x+p.y)*p.z); }',
  'float noise3(vec3 p) { vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); float a=hash3(i),b=hash3(i+vec3(1,0,0)),c=hash3(i+vec3(0,1,0)),d=hash3(i+vec3(1,1,0)); float e=hash3(i+vec3(0,0,1)),g=hash3(i+vec3(1,0,1)),h=hash3(i+vec3(0,1,1)),j=hash3(i+vec3(1,1,1)); return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(h,j,f.x),f.y),f.z); }',
  'float cloudField(vec3 p) { return noise3(p)*0.56+noise3(p*2.03+vec3(7.1,13.4,3.2))*0.29+noise3(p*4.07+vec3(-4.8,5.2,17.1))*0.15; }',
  'void main() {',
  '  vec3 ray=normalize(vWorldPosition-uCamera);',
  '  if(abs(ray.y)<0.035){gl_FragColor=vec4(0.0);return;}',
  '  float aboveSlab=step(1850.0,uCamera.y);',
  '  vec3 marchDirection=mix(-ray,ray,aboveSlab);',
  '  float rayLength=350.0/abs(ray.y);',
  '  if(uCamera.y>=1500.0&&uCamera.y<1850.0) rayLength=(1850.0-uCamera.y)/abs(ray.y);',
  '  if(rayLength<=0.0||rayLength>8500.0){gl_FragColor=vec4(0.0);return;}',
  '  float stepLength=rayLength/20.0;',
  '  float transmittance=1.0;',
  '  vec3 radiance=vec3(0.0);',
  '  for(int i=0;i<20;i++){',
  '    vec3 p=vWorldPosition+marchDirection*((float(i)+0.5)*stepLength);',
  '    vec3 q=vec3(p.xz*0.0025,(p.y-1680.0)*0.0075+uTime*0.0015);',
  '    float field=cloudField(q);',
  '    float vertical=smoothstep(1500.0,1580.0,p.y)*(1.0-smoothstep(1795.0,1850.0,p.y));',
  '    float density=smoothstep(0.405,0.625,field)*vertical;',
  '    float absorption=1.0-exp(-density*stepLength*0.0019);',
  '    float shade=clamp(0.48+field*0.96+vertical*0.18,0.42,1.12);',
  '    vec3 cloudColor=mix(vec3(0.36,0.48,0.58),vec3(0.97,0.975,0.95),shade);',
  '    radiance+=transmittance*absorption*cloudColor;',
  '    transmittance*=1.0-absorption;',
  '    if(transmittance<0.035) break;',
  '  }',
  '  float opacity=1.0-transmittance;',
  '  gl_FragColor=vec4(radiance/max(opacity,0.0001),opacity);',
  '  #include <tonemapping_fragment>',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');

function eventStyle(type: Exclude<GameEvent['type'], 'spawn'>): { life: number; radius: number; color: number } {
  switch (type) {
    case 'shot': return { life: 0.16, radius: 0.18, color: 0xffebad };
    case 'hit': return { life: 0.48, radius: 0.47, color: 0xffeab0 };
    case 'damage': return { life: 0.77, radius: 0.72, color: 0xff8d66 };
    case 'kill': return { life: 1.04, radius: 1.5, color: 0xffb778 };
    case 'loop': return { life: 0.65, radius: 0.62, color: 0xbdeaf0 };
    case 'end': return { life: 0.95, radius: 1.2, color: 0xffd5a0 };
  }
}

export class FlightScene {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FLIGHT_FOV, 1, 0.1, FLIGHT_FAR);
  private readonly renderer: WebGLRenderer;
  private readonly factory = new AircraftFactory();
  private readonly playerVisual: AircraftVisual;
  private readonly enemyVisuals = new Map<number, AircraftVisual>();
  private readonly wreckVisuals = new Map<number, WreckVisual>();
  private readonly smokeEmitters = new Map<number, SmokeEmitter>();
  private readonly sky: CanvasTexture;
  private readonly cloudGeometry: PlaneGeometry;
  private readonly cloudMaterial: ShaderMaterial;
  private readonly cloudPlane: Mesh;
  private readonly tracerGeometry: CylinderGeometry;
  private readonly tracerCoreGeometry: CylinderGeometry;
  private readonly playerTracerMaterial: MeshBasicMaterial;
  private readonly enemyTracerMaterial: MeshBasicMaterial;
  private readonly playerTracerCoreMaterial: MeshBasicMaterial;
  private readonly enemyTracerCoreMaterial: MeshBasicMaterial;
  private readonly playerTracers: InstancedMesh;
  private readonly enemyTracers: InstancedMesh;
  private readonly playerTracerCores: InstancedMesh;
  private readonly enemyTracerCores: InstancedMesh;
  private readonly flashGeometry: SphereGeometry;
  private readonly ringGeometry: TorusGeometry;
  private readonly smokeGeometry: SphereGeometry;
  private readonly flashMaterial: MeshBasicMaterial;
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly smokeMaterial: MeshBasicMaterial;
  private readonly flashes: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly smoke: InstancedMesh;
  private readonly plumeGeometry: PlaneGeometry;
  private readonly plumeTexture: CanvasTexture;
  private readonly flameTexture: CanvasTexture;
  private readonly plumeMaterial: MeshBasicMaterial;
  private readonly flameMaterial: MeshBasicMaterial;
  private readonly plumeSmoke: InstancedMesh;
  private readonly wreckFlames: InstancedMesh;
  private readonly plumeParticles = particleSlots(MAX_PLUME_SMOKE);
  private readonly flameParticles = particleSlots(MAX_WRECK_FLAMES);
  private plumeCursor = 0;
  private flameCursor = 0;
  private readonly seenEventIds = new Set<number>();
  private readonly eventOrder: number[] = [];
  private readonly effects: VisualEvent[] = [];
  private readonly dummy = new Object3D();
  private readonly tempColor = new Color();
  private readonly direction = new Vector3();
  private readonly aimWorld = new Vector3();
  private readonly projectedAim = new Vector3();
  private readonly plumeLocal = new Vector3();
  private readonly plumeWorld = new Vector3();
  private readonly plumeForward = new Vector3();
  private readonly plumeVelocity = new Vector3();
  private readonly canvas: HTMLCanvasElement;
  private cssWidth = 1;
  private cssHeight = 1;
  private visualTime = 0;
  private activeSeed: number | null = null;
  private lastElapsed = 0;
  private lastPhase: GameState['phase'] | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));

    this.sky = buildSky();
    this.scene.background = this.sky;
    this.scene.environment = this.sky;
    this.scene.environmentIntensity = 0.62;
    this.scene.fog = new Fog(0xa9c6d2, 250, 1450);
    this.scene.add(new HemisphereLight(0xd2e8f4, 0x52616d, 1.55));
    const sun = new DirectionalLight(0xffe6c5, 2);
    sun.position.set(-34, 52, 16);
    this.scene.add(sun);
    const skyFill = new DirectionalLight(0x9ac8e1, 0.68);
    skyFill.position.set(24, 18, -36);
    this.scene.add(skyFill);
    this.scene.add(new AmbientLight(0x526a82, 0.17));

    this.cloudGeometry = new PlaneGeometry(14000, 14000);
    this.cloudGeometry.rotateX(-Math.PI / 2);
    this.cloudMaterial = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCamera: { value: new Vector3() } },
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: true,
    });
    this.cloudPlane = new Mesh(this.cloudGeometry, this.cloudMaterial);
    this.cloudPlane.renderOrder = -2;
    this.cloudPlane.frustumCulled = false;
    this.scene.add(this.cloudPlane);

    this.playerVisual = this.factory.create('hero');
    this.scene.add(this.playerVisual.root);

    this.tracerGeometry = new CylinderGeometry(0.022, 0.074, 1, 6, 1, false);
    this.tracerCoreGeometry = new CylinderGeometry(0.019, 0.036, 1, 5, 1, false);
    // Instance colors come from setColorAt. These shared geometries have no
    // per-vertex color attribute, so enabling vertexColors would multiply by black.
    this.playerTracerMaterial = new MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.94,
      depthWrite: false, blending: AdditiveBlending,
    });
    this.enemyTracerMaterial = new MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.84,
      depthWrite: false, blending: AdditiveBlending,
    });
    this.playerTracerCoreMaterial = new MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.98,
      depthWrite: false, blending: AdditiveBlending,
    });
    this.enemyTracerCoreMaterial = new MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.88,
      depthWrite: false, blending: AdditiveBlending,
    });
    this.playerTracers = new InstancedMesh(this.tracerGeometry, this.playerTracerMaterial, MAX_TRACERS);
    this.enemyTracers = new InstancedMesh(this.tracerGeometry, this.enemyTracerMaterial, MAX_TRACERS);
    this.playerTracerCores = new InstancedMesh(this.tracerCoreGeometry, this.playerTracerCoreMaterial, MAX_TRACERS);
    this.enemyTracerCores = new InstancedMesh(this.tracerCoreGeometry, this.enemyTracerCoreMaterial, MAX_TRACERS);
    this.playerTracers.frustumCulled = false;
    this.enemyTracers.frustumCulled = false;
    this.playerTracerCores.frustumCulled = false;
    this.enemyTracerCores.frustumCulled = false;
    this.playerTracers.visible = this.enemyTracers.visible = false;
    this.playerTracerCores.visible = this.enemyTracerCores.visible = false;
    this.playerTracers.renderOrder = this.enemyTracers.renderOrder = 2;
    this.playerTracerCores.renderOrder = this.enemyTracerCores.renderOrder = 3;
    this.scene.add(this.playerTracers, this.enemyTracers, this.playerTracerCores, this.enemyTracerCores);

    this.flashGeometry = new SphereGeometry(1, 10, 7);
    this.ringGeometry = new TorusGeometry(1, 0.035, 5, 28);
    this.smokeGeometry = new SphereGeometry(1, 9, 6);
    this.flashMaterial = new MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.76,
      depthWrite: false, blending: AdditiveBlending,
    });
    this.ringMaterial = new MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.82,
      depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    });
    this.smokeMaterial = new MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.30,
      depthWrite: false,
    });
    this.flashes = new InstancedMesh(this.flashGeometry, this.flashMaterial, MAX_EFFECTS);
    this.rings = new InstancedMesh(this.ringGeometry, this.ringMaterial, MAX_EFFECTS);
    this.smoke = new InstancedMesh(this.smokeGeometry, this.smokeMaterial, MAX_EFFECTS);
    this.flashes.frustumCulled = false;
    this.rings.frustumCulled = false;
    this.smoke.frustumCulled = false;
    this.flashes.visible = this.rings.visible = this.smoke.visible = false;
    this.flashes.renderOrder = this.rings.renderOrder = 4;
    this.smoke.renderOrder = 3;
    this.scene.add(this.smoke, this.flashes, this.rings);

    this.plumeGeometry = new PlaneGeometry(1, 1);
    this.plumeTexture = buildSmokeTexture();
    this.flameTexture = buildFlameTexture();
    this.plumeMaterial = new MeshBasicMaterial({
      map: this.plumeTexture, color: 0xffffff, transparent: true,
      opacity: 0.92, depthWrite: false, side: DoubleSide,
    });
    this.flameMaterial = new MeshBasicMaterial({
      map: this.flameTexture, color: 0xffffff, transparent: true,
      opacity: 0.92, depthWrite: false, side: DoubleSide,
    });
    this.plumeSmoke = new InstancedMesh(this.plumeGeometry, this.plumeMaterial, MAX_PLUME_SMOKE);
    this.wreckFlames = new InstancedMesh(this.plumeGeometry, this.flameMaterial, MAX_WRECK_FLAMES);
    this.plumeSmoke.frustumCulled = this.wreckFlames.frustumCulled = false;
    this.plumeSmoke.visible = this.wreckFlames.visible = false;
    this.plumeSmoke.renderOrder = 3;
    this.wreckFlames.renderOrder = 5;
    this.scene.add(this.plumeSmoke, this.wreckFlames);

    const bounds = canvas.getBoundingClientRect();
    this.resize(bounds.width || canvas.clientWidth || 1, bounds.height || canvas.clientHeight || 1);
  }

  resize(width: number, height: number): void {
    if (this.disposed || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    this.cssWidth = width;
    this.cssHeight = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(state: GameState, dt: number): void {
    if (this.disposed) return;
    const frameDt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const motionDt = state.phase === 'paused' ? 0 : frameDt;
    this.visualTime += motionDt;
    this.beginSession(state);
    this.updateAircraft(this.playerVisual, state.player, motionDt);
    this.updateCamera(state.player, state.enemies, state.mode);
    this.updateEnemies(state.enemies, motionDt);
    this.updateWrecks(state.wrecks);
    this.updateClouds(state.player.position);
    this.updateTracers(state);
    this.collectEvents(state.events);
    this.updateEffects(motionDt);
    this.updateFlightVfx(state, motionDt);
    if (this.cssWidth > 0 && this.cssHeight > 0) this.renderer.render(this.scene, this.camera);
  }

  private beginSession(state: GameState): void {
    const newSession = this.activeSeed !== null && (
      state.seed !== this.activeSeed ||
      state.elapsed + 0.25 < this.lastElapsed ||
      (state.phase === 'ready' && this.lastPhase !== 'ready') ||
      (state.phase === 'playing' && (this.lastPhase === 'ready' || this.lastPhase === 'ended'))
    );
    if (newSession) {
      this.seenEventIds.clear();
      this.eventOrder.length = 0;
      this.effects.length = 0;
      this.clearFlightVfx();
    }
    this.activeSeed = state.seed;
    this.lastElapsed = state.elapsed;
    this.lastPhase = state.phase;
  }

  private updateAircraft(visual: AircraftVisual, aircraft: Aircraft, dt: number): void {
    visual.root.position.copy(aircraft.position);
    visual.root.quaternion.copy(aircraft.quaternion);
    visual.propeller.rotation.z = (visual.propeller.rotation.z + dt * (34 + Math.min(8, aircraft.speed * 0.035))) % (Math.PI * 2);
    const deflection = clamp(aircraft.bank * 0.34, -0.30, 0.30);
    visual.ailerons[0].rotation.x = deflection;
    visual.ailerons[1].rotation.x = -deflection;
    visual.elevator.rotation.x = clamp(-aircraft.pitch * 0.32, -0.26, 0.26);
  }

  private updateCamera(player: Aircraft, enemies: Aircraft[], mode: GameMode): void {
    getFlightCameraPose(player, mode, this.camera.position, this.camera.quaternion);
    this.camera.updateMatrixWorld();
    this.direction.set(0, 0, -1).applyQuaternion(player.quaternion);
    let aimDepth = 500;
    let bestAlignment = -1;
    for (const enemy of enemies) {
      const toEnemy = enemy.position.clone().sub(player.position);
      const depth = toEnemy.dot(this.direction);
      if (depth < 24 || depth > 1200) continue;
      const alignment = depth / Math.max(1e-4, toEnemy.length());
      if (alignment > bestAlignment) {
        bestAlignment = alignment;
        aimDepth = depth;
      }
    }
    this.aimWorld.set(0, 0, -4.5).applyQuaternion(player.quaternion).add(player.position);
    this.aimWorld.addScaledVector(this.direction, aimDepth);
    this.projectedAim.copy(this.aimWorld).project(this.camera);
  }

  private updateEnemies(aircraft: Aircraft[], dt: number): void {
    const present = new Set<number>();
    for (const enemy of aircraft) {
      present.add(enemy.id);
      let visual = this.enemyVisuals.get(enemy.id);
      if (!visual) {
        visual = this.factory.create('enemy');
        this.enemyVisuals.set(enemy.id, visual);
        this.scene.add(visual.root);
      }
      this.updateAircraft(visual, enemy, dt);
    }
    for (const [id, visual] of this.enemyVisuals) {
      if (!present.has(id)) {
        this.scene.remove(visual.root);
        this.enemyVisuals.delete(id);
      }
    }
  }

  private updateWrecks(wrecks: GameState['wrecks']): void {
    const present = new Set<number>();
    for (const wreck of wrecks) {
      present.add(wreck.id);
      let entry = this.wreckVisuals.get(wreck.id);
      if (!entry) {
        const visual = this.factory.create('enemy');
        visual.root.name = 'burning A6M2 wreck';
        this.scene.add(visual.root);
        entry = { visual, nextSmokeAt: 0, nextFireAt: 0, smokeSerial: 0, fireSerial: 0 };
        this.wreckVisuals.set(wreck.id, entry);
      }
      entry.visual.root.position.copy(wreck.position);
      entry.visual.root.quaternion.copy(wreck.quaternion);
      entry.visual.propeller.rotation.z = Math.min(wreck.age, 0.9) * 24;
    }
    for (const [id, entry] of this.wreckVisuals) {
      if (!present.has(id)) {
        this.scene.remove(entry.visual.root);
        this.wreckVisuals.delete(id);
      }
    }
  }

  private spawnSmoke(
    position: Vector3,
    quaternion: Quaternion,
    velocity: Vector3,
    id: number,
    serial: number,
    dark: boolean,
  ): void {
    const random = rng((Math.imul(id + 17, 0x9e3779b1) ^ Math.imul(serial + 31, 0x85ebca6b)) >>> 0);
    const particle = this.plumeParticles[this.plumeCursor];
    this.plumeCursor = (this.plumeCursor + 1) % this.plumeParticles.length;
    this.plumeLocal.set((random() - 0.5) * 0.20, 0.46 + (random() - 0.5) * 0.16, -3.38 + (random() - 0.5) * 0.18);
    particle.position.copy(position).add(this.plumeLocal.applyQuaternion(quaternion));
    particle.velocity.copy(velocity).multiplyScalar(dark ? 0.62 : 0.76);
    particle.velocity.x += (random() - 0.5) * 4.2;
    particle.velocity.y += 2.4 + random() * 4.2;
    particle.velocity.z += (random() - 0.5) * 4.2;
    particle.age = 0;
    particle.life = 2.35 + random() * 0.9;
    particle.size = dark ? 1.65 + random() * 0.9 : 1.20 + random() * 0.72;
    particle.seed = (id * 73856093 ^ serial * 19349663) >>> 0;
    particle.dark = dark;
    particle.active = true;
  }

  private spawnWreckFlame(position: Vector3, quaternion: Quaternion, velocity: Vector3, id: number, serial: number): void {
    const random = rng((Math.imul(id + 79, 0xc2b2ae35) ^ Math.imul(serial + 7, 0x27d4eb2f)) >>> 0);
    const particle = this.flameParticles[this.flameCursor];
    this.flameCursor = (this.flameCursor + 1) % this.flameParticles.length;
    this.plumeLocal.copy(WRECK_FIRE_POINTS[serial % WRECK_FIRE_POINTS.length]);
    this.plumeLocal.x += (random() - 0.5) * 0.42;
    this.plumeLocal.y += (random() - 0.5) * 0.25;
    this.plumeLocal.z += (random() - 0.5) * 0.42;
    particle.position.copy(position).add(this.plumeLocal.applyQuaternion(quaternion));
    particle.velocity.copy(velocity).multiplyScalar(0.55);
    particle.velocity.x += (random() - 0.5) * 3.2;
    particle.velocity.y += 2.0 + random() * 4.0;
    particle.velocity.z += (random() - 0.5) * 3.2;
    particle.age = 0;
    particle.life = 0.32 + random() * 0.35;
    particle.size = 1.15 + random() * 1.15;
    particle.seed = (id * 19349663 ^ serial * 83492791) >>> 0;
    particle.dark = false;
    particle.active = true;
  }

  private updateFlightVfx(state: GameState, dt: number): void {
    if (state.phase === 'playing') {
      const activeEmitters = new Set<number>();
      for (const aircraft of state.enemies) {
        if (aircraft.health <= 0 || aircraft.health > 30) continue;
        activeEmitters.add(aircraft.id);
        let emitter = this.smokeEmitters.get(aircraft.id);
        if (!emitter) {
          emitter = { nextAt: aircraft.age, serial: 0 };
          this.smokeEmitters.set(aircraft.id, emitter);
        }
        if (aircraft.age + 1e-4 >= emitter.nextAt) {
          this.plumeForward.set(0, 0, -1).applyQuaternion(aircraft.quaternion);
          this.plumeVelocity.copy(this.plumeForward).multiplyScalar(aircraft.speed);
          this.spawnSmoke(aircraft.position, aircraft.quaternion, this.plumeVelocity, aircraft.id, emitter.serial++, false);
          const healthFactor = 1 - clamp(aircraft.health, 0, 30) / 30;
          emitter.nextAt = aircraft.age + 1 / (8 + healthFactor * 4);
        }
      }
      for (const id of this.smokeEmitters.keys()) {
        if (!activeEmitters.has(id)) this.smokeEmitters.delete(id);
      }
    }

    // A run may have ended on the fatal hit while its five-second wreck still
    // descends on the result screen. Keep that presentation on the same wreck
    // clock; damage smoke from surviving enemies remains a playing-only effect.
    if (state.phase === 'playing' || state.phase === 'ended') {
      for (const wreck of state.wrecks) {
        const entry = this.wreckVisuals.get(wreck.id);
        if (!entry) continue;
        if (wreck.age + 1e-4 >= entry.nextSmokeAt) {
          this.spawnSmoke(wreck.position, wreck.quaternion, wreck.velocity, wreck.id, entry.smokeSerial++, true);
          entry.nextSmokeAt = wreck.age + 0.18;
        }
        if (wreck.age + 1e-4 >= entry.nextFireAt) {
          this.spawnWreckFlame(wreck.position, wreck.quaternion, wreck.velocity, wreck.id, entry.fireSerial++);
          entry.nextFireAt = wreck.age + 0.12;
        }
      }
    }

    const particleDt = state.phase === 'playing' || state.phase === 'ended' ? dt : 0;
    for (const particle of this.plumeParticles) {
      if (!particle.active) continue;
      particle.age += particleDt;
      if (particle.age >= particle.life) {
        particle.active = false;
        continue;
      }
      particle.position.addScaledVector(particle.velocity, particleDt);
    }
    for (const particle of this.flameParticles) {
      if (!particle.active) continue;
      particle.age += particleDt;
      if (particle.age >= particle.life) {
        particle.active = false;
        continue;
      }
      particle.position.addScaledVector(particle.velocity, particleDt);
    }

    this.updateParticleMesh(this.plumeParticles, this.plumeSmoke, false);
    this.updateParticleMesh(this.flameParticles, this.wreckFlames, true);
  }

  private updateParticleMesh(particles: ParticleSlot[], mesh: InstancedMesh, flame: boolean): void {
    let count = 0;
    for (const particle of particles) {
      if (!particle.active) continue;
      const t = clamp(particle.age / particle.life, 0, 1);
      const fade = Math.pow(1 - t, flame ? 0.72 : 1.32);
      this.dummy.position.copy(particle.position);
      this.dummy.quaternion.copy(this.camera.quaternion);
      const pulse = flame ? 0.82 + 0.18 * Math.sin(particle.age * 29 + (particle.seed % 19)) : 1;
      this.dummy.scale.set(
        particle.size * (flame ? 0.74 : 0.78 + t * 0.70) * pulse,
        particle.size * (flame ? 1.30 : 0.68 + t * 1.28) * pulse,
        1,
      );
      this.dummy.rotation.z = flame ? Math.sin(particle.age * 8 + (particle.seed % 11)) * 0.16 : (particle.seed % 13) * 0.025;
      this.dummy.updateMatrix();
      mesh.setMatrixAt(count, this.dummy.matrix);
      if (flame) {
        const warmth = 0.42 + ((particle.seed >>> 8) % 32) / 100;
        this.tempColor.setRGB(1.0, warmth, 0.07).multiplyScalar(fade);
      } else if (particle.dark) {
        this.tempColor.setRGB(0.19, 0.20, 0.21).multiplyScalar(fade);
      } else {
        this.tempColor.setRGB(0.36, 0.38, 0.39).multiplyScalar(fade);
      }
      mesh.setColorAt(count, this.tempColor);
      count++;
    }
    mesh.count = count;
    mesh.visible = count > 0;
    if (count) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private clearFlightVfx(): void {
    for (const entry of this.wreckVisuals.values()) this.scene.remove(entry.visual.root);
    this.wreckVisuals.clear();
    this.smokeEmitters.clear();
    for (const particle of this.plumeParticles) particle.active = false;
    for (const particle of this.flameParticles) particle.active = false;
    this.plumeCursor = 0;
    this.flameCursor = 0;
    this.plumeSmoke.count = this.wreckFlames.count = 0;
    this.plumeSmoke.visible = this.wreckFlames.visible = false;
  }

  private updateClouds(position: Vector3): void {
    this.cloudPlane.position.set(position.x, 1850, position.z);
    this.cloudMaterial.uniforms.uTime.value = this.visualTime;
    (this.cloudMaterial.uniforms.uCamera.value as Vector3).copy(this.camera.position);
  }

  private updateTracers(state: GameState): void {
    let playerCount = 0;
    let enemyCount = 0;
    const playerColor = new Color();
    const enemyColor = new Color();
    for (const bullet of state.bullets) {
      const playerShot = bullet.owner === state.player.id;
      if (playerShot ? playerCount >= MAX_TRACERS : enemyCount >= MAX_TRACERS) continue;
      this.direction.subVectors(bullet.position, bullet.previous);
      const traveled = this.direction.length();
      if (traveled < 1e-5) this.direction.copy(bullet.velocity);
      if (this.direction.lengthSq() < 1e-7) this.direction.set(0, 0, -1);
      this.direction.normalize();
      // The broad, subdued segment uses the actual last simulation step. Its
      // bright core stays at the current bullet position for distance reading.
      this.dummy.quaternion.setFromUnitVectors(UP, this.direction);
      const length = clamp(traveled, 0.25, 32);
      // Keep combat-distance tracers legible; only their displayed width changes.
      const widthScale = clamp(this.camera.position.distanceTo(bullet.position) / 45, 1.2, 14);
      const coreLength = bullet.kind === 'cannon' ? 1.9 : 1.35;
      const coreRadius = (bullet.kind === 'cannon' ? 1.3 : 1) * widthScale;
      if (playerShot) {
        const index = playerCount++;
        this.dummy.position.copy(bullet.position).addScaledVector(this.direction, -length * 0.5);
        this.dummy.scale.set((bullet.kind === 'cannon' ? 1.12 : 0.9) * widthScale, length, (bullet.kind === 'cannon' ? 1.12 : 0.9) * widthScale);
        this.dummy.updateMatrix();
        this.playerTracers.setMatrixAt(index, this.dummy.matrix);
        playerColor.setHex(bullet.kind === 'cannon' ? 0xffbd4a : 0xffd16c);
        this.playerTracers.setColorAt(index, playerColor);
        this.dummy.position.copy(bullet.position).addScaledVector(this.direction, -coreLength * 0.38);
        this.dummy.scale.set(coreRadius, coreLength, coreRadius);
        this.dummy.updateMatrix();
        this.playerTracerCores.setMatrixAt(index, this.dummy.matrix);
        playerColor.setHex(bullet.kind === 'cannon' ? 0xfff5c5 : 0xffefad);
        this.playerTracerCores.setColorAt(index, playerColor);
      } else {
        const index = enemyCount++;
        this.dummy.position.copy(bullet.position).addScaledVector(this.direction, -length * 0.5);
        this.dummy.scale.set((bullet.kind === 'cannon' ? 1.12 : 0.9) * widthScale, length, (bullet.kind === 'cannon' ? 1.12 : 0.9) * widthScale);
        this.dummy.updateMatrix();
        this.enemyTracers.setMatrixAt(index, this.dummy.matrix);
        enemyColor.setHex(bullet.kind === 'cannon' ? 0xff5533 : 0xed5044);
        this.enemyTracers.setColorAt(index, enemyColor);
        this.dummy.position.copy(bullet.position).addScaledVector(this.direction, -coreLength * 0.38);
        this.dummy.scale.set(coreRadius, coreLength, coreRadius);
        this.dummy.updateMatrix();
        this.enemyTracerCores.setMatrixAt(index, this.dummy.matrix);
        enemyColor.setHex(bullet.kind === 'cannon' ? 0xffc184 : 0xff9c83);
        this.enemyTracerCores.setColorAt(index, enemyColor);
      }
    }
    this.playerTracers.count = playerCount;
    this.enemyTracers.count = enemyCount;
    this.playerTracerCores.count = playerCount;
    this.enemyTracerCores.count = enemyCount;
    this.playerTracers.visible = this.playerTracerCores.visible = playerCount > 0;
    this.enemyTracers.visible = this.enemyTracerCores.visible = enemyCount > 0;
    if (playerCount) {
      this.playerTracers.instanceMatrix.needsUpdate = true;
      this.playerTracerCores.instanceMatrix.needsUpdate = true;
      if (this.playerTracers.instanceColor) this.playerTracers.instanceColor.needsUpdate = true;
      if (this.playerTracerCores.instanceColor) this.playerTracerCores.instanceColor.needsUpdate = true;
    }
    if (enemyCount) {
      this.enemyTracers.instanceMatrix.needsUpdate = true;
      this.enemyTracerCores.instanceMatrix.needsUpdate = true;
      if (this.enemyTracers.instanceColor) this.enemyTracers.instanceColor.needsUpdate = true;
      if (this.enemyTracerCores.instanceColor) this.enemyTracerCores.instanceColor.needsUpdate = true;
    }
  }

  private collectEvents(events: GameEvent[]): void {
    for (const event of events) {
      if (event.type === 'spawn') continue;
      if (this.seenEventIds.has(event.id)) continue;
      this.seenEventIds.add(event.id);
      this.eventOrder.push(event.id);
      if (this.eventOrder.length > 2048) {
        const oldest = this.eventOrder.shift();
        if (oldest !== undefined) this.seenEventIds.delete(oldest);
      }
      const style = eventStyle(event.type);
      if (this.effects.length >= MAX_EFFECTS) {
        let oldest = 0;
        for (let i = 1; i < this.effects.length; i++) {
          if (this.effects[i].age / this.effects[i].life > this.effects[oldest].age / this.effects[oldest].life) oldest = i;
        }
        this.effects.splice(oldest, 1);
      }
      this.effects.push({
        id: event.id,
        position: event.position.clone(),
        age: 0,
        life: style.life,
        radius: style.radius,
        color: new Color(style.color),
      });
    }
  }

  private updateEffects(dt: number): void {
    if (dt > 0) {
      for (const effect of this.effects) effect.age += dt;
      for (let i = this.effects.length - 1; i >= 0; i--) {
        if (this.effects[i].age >= this.effects[i].life) this.effects.splice(i, 1);
      }
    }
    let count = 0;
    for (const effect of this.effects) {
      if (count >= MAX_EFFECTS) break;
      const t = clamp(effect.age / effect.life, 0, 1);
      const fade = Math.pow(1 - t, 1.15);
      const size = effect.radius * (0.18 + t * 0.82);
      this.dummy.position.copy(effect.position);
      this.dummy.position.y += t * effect.radius * 0.46;
      this.dummy.quaternion.identity();
      this.dummy.scale.setScalar(size * (0.20 + 0.46 * (1 - t)));
      this.dummy.updateMatrix();
      this.flashes.setMatrixAt(count, this.dummy.matrix);
      this.tempColor.copy(effect.color).multiplyScalar(fade);
      this.flashes.setColorAt(count, this.tempColor);

      this.dummy.position.copy(effect.position);
      this.dummy.position.y += t * effect.radius * 0.20;
      this.dummy.quaternion.copy(this.camera.quaternion);
      this.dummy.scale.setScalar(size);
      this.dummy.updateMatrix();
      this.rings.setMatrixAt(count, this.dummy.matrix);
      this.tempColor.copy(effect.color).multiplyScalar(fade * 0.82);
      this.rings.setColorAt(count, this.tempColor);

      this.dummy.position.copy(effect.position);
      this.dummy.position.y += t * effect.radius * 0.68;
      this.dummy.quaternion.identity();
      this.dummy.scale.set(size * 0.38, size * 0.54, size * 0.38);
      this.dummy.updateMatrix();
      this.smoke.setMatrixAt(count, this.dummy.matrix);
      this.tempColor.setRGB(0.43, 0.47, 0.47).multiplyScalar(fade);
      this.smoke.setColorAt(count, this.tempColor);
      count++;
    }
    this.flashes.count = this.rings.count = this.smoke.count = count;
    this.flashes.visible = this.rings.visible = this.smoke.visible = count > 0;
    if (count) {
      this.flashes.instanceMatrix.needsUpdate = true;
      this.rings.instanceMatrix.needsUpdate = true;
      this.smoke.instanceMatrix.needsUpdate = true;
      if (this.flashes.instanceColor) this.flashes.instanceColor.needsUpdate = true;
      if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
      if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
    }
  }

  aimScreen(): { x: number; y: number } {
    const bounds = this.canvas.getBoundingClientRect();
    const width = bounds.width || this.cssWidth;
    const height = bounds.height || this.cssHeight;
    return {
      x: (this.projectedAim.x * 0.5 + 0.5) * width,
      y: (0.5 - this.projectedAim.y * 0.5) * height,
    };
  }

  stats(): SceneStats {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearFlightVfx();
    this.scene.remove(this.playerVisual.root);
    for (const visual of this.enemyVisuals.values()) this.scene.remove(visual.root);
    this.enemyVisuals.clear();
    this.scene.remove(
      this.cloudPlane,
      this.playerTracers,
      this.enemyTracers,
      this.playerTracerCores,
      this.enemyTracerCores,
      this.flashes,
      this.rings,
      this.smoke,
      this.plumeSmoke,
      this.wreckFlames,
    );
    this.sky.dispose();
    this.cloudGeometry.dispose();
    this.cloudMaterial.dispose();
    this.tracerGeometry.dispose();
    this.tracerCoreGeometry.dispose();
    this.playerTracerMaterial.dispose();
    this.enemyTracerMaterial.dispose();
    this.playerTracerCoreMaterial.dispose();
    this.enemyTracerCoreMaterial.dispose();
    this.flashGeometry.dispose();
    this.ringGeometry.dispose();
    this.smokeGeometry.dispose();
    this.flashMaterial.dispose();
    this.ringMaterial.dispose();
    this.smokeMaterial.dispose();
    this.plumeGeometry.dispose();
    this.plumeTexture.dispose();
    this.flameTexture.dispose();
    this.plumeMaterial.dispose();
    this.flameMaterial.dispose();
    this.factory.dispose();
    this.renderer.dispose();
  }
}
