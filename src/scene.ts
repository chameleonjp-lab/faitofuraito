import { aircraftEventParticles, sampleAircraftParticle, AIRCRAFT_EFFECT_CAPACITY, AIRCRAFT_PARTICLE_VERTEX, AIRCRAFT_PARTICLE_FRAGMENT, type AircraftParticle } from './aircraft-vfx';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  CanvasTexture,
  CylinderGeometry,
  Points,
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { projectGunSight } from './gun-sight';
import { AircraftFactory, type AircraftVisual } from './aircraft';
import type { Aircraft, GameEvent, GameMode, GameState } from './types';
import { FLIGHT_FOV, FLIGHT_VISIBILITY_RANGE, getFlightCameraPose } from './flight-view';

type SceneStats = { calls: number; triangles: number; geometries: number; textures: number; aircraftParticles:number; wreckModels:number; persistentDamageSmoke:number };
type WreckVisual = { visual: AircraftVisual };

const MAX_TRACERS = 2048;
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

export class FlightScene {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FLIGHT_FOV, 1, 0.5, 22000);
  private readonly renderer: WebGLRenderer;
  private readonly factory = new AircraftFactory();
  private readonly playerVisual: AircraftVisual;
  private readonly enemyVisuals = new Map<number, AircraftVisual>();
  private readonly wreckVisuals = new Map<number, WreckVisual>();
  private readonly sky: CanvasTexture;
  private readonly cloudGeometry: PlaneGeometry;
  private readonly cloudMaterial: ShaderMaterial;
  private readonly cloudPlane: Mesh;
  private readonly tracerGeometry = new BufferGeometry();
  private readonly tracerPositions = new Float32Array(MAX_TRACERS * 6);
  private readonly tracerColors = new Float32Array(MAX_TRACERS * 6);
  private readonly tracerMaterial: LineBasicMaterial;
  private readonly tracers: LineSegments;
  private readonly particleGeometry = new BufferGeometry();
  private readonly particlePositions = new Float32Array(AIRCRAFT_EFFECT_CAPACITY * 3);
  private readonly particleColors = new Float32Array(AIRCRAFT_EFFECT_CAPACITY * 3);
  private readonly particleSizes = new Float32Array(AIRCRAFT_EFFECT_CAPACITY);
  private readonly particleOpacity = new Float32Array(AIRCRAFT_EFFECT_CAPACITY);
  private readonly particleMaterial: ShaderMaterial;
  private readonly points: Points;
  private particles: AircraftParticle[] = [];
  private readonly teamBandGeometry = new CylinderGeometry(.34,.39,.6,14,1,true);
  private readonly enemyBandMaterial = new MeshBasicMaterial({color:0xe29b55});
  private lastVfxElapsed = 0;
  private readonly seenEventIds = new Set<number>();
  private readonly eventOrder: number[] = [];
  private readonly projectedAim = new Vector3();
  private readonly canvas: HTMLCanvasElement;
  private cssWidth = 1;
  private cssHeight = 1;
  private visualTime = 0;
  private cloudTime = 0;
  private activeGame: GameState | null = null;
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
    // Preserve this sky world's atmospheric fog. Aircraft models no longer
    // have a separate 1.5km hard hide; aim/radar gates remain unchanged.
    this.scene.fog = new Fog(0xa9c6d2, 250, FLIGHT_VISIBILITY_RANGE + 400);
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

    // Aircraft tracer display matches Kaisen c63bff8: a thin, depth-tested
    // 25 ms velocity segment. Neither display width nor tail changes hit tests.
    this.tracerGeometry.setAttribute('position', new BufferAttribute(this.tracerPositions, 3));
    this.tracerGeometry.setAttribute('color', new BufferAttribute(this.tracerColors, 3));
    this.tracerGeometry.setDrawRange(0, 0);
    this.tracerMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .9 });
    this.tracers = new LineSegments(this.tracerGeometry, this.tracerMaterial);
    this.tracers.frustumCulled = false;
    this.scene.add(this.tracers);

    this.particleGeometry.setAttribute('position',new BufferAttribute(this.particlePositions,3));
    this.particleGeometry.setAttribute('color',new BufferAttribute(this.particleColors,3));
    this.particleGeometry.setAttribute('size',new BufferAttribute(this.particleSizes,1));
    this.particleGeometry.setAttribute('opacity',new BufferAttribute(this.particleOpacity,1));
    this.particleGeometry.setDrawRange(0,0);
    this.particleMaterial = new ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,
      vertexShader:AIRCRAFT_PARTICLE_VERTEX,fragmentShader:AIRCRAFT_PARTICLE_FRAGMENT});
    this.points = new Points(this.particleGeometry,this.particleMaterial);
    this.points.frustumCulled=false;this.scene.add(this.points);

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
    const frameDt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    // Keep FightFlight's independent atmospheric clock, including the home view.
    if(state.phase!=='paused')this.cloudTime+=frameDt;
    this.beginSession(state);
    const motionDt = Math.max(0,Math.min(.1,state.elapsed-this.lastVfxElapsed));
    this.visualTime = state.phase === 'ended' ? this.visualTime + Math.min(.1,frameDt) : state.elapsed;
    const effectDt = 0;
    this.lastVfxElapsed = state.elapsed;
    this.updateAircraft(this.playerVisual, state.player, motionDt);
    this.updateCamera(state.player, state.mode);
    this.updateWrecks(state.wrecks,motionDt);
    this.updateEnemies(state.enemies, motionDt);
    this.updateClouds(state.player.position);
    this.updateTracers(state);
    this.collectEvents(state.events);
    this.updateEffects(effectDt);
    if (this.cssWidth > 0 && this.cssHeight > 0) this.renderer.render(this.scene, this.camera);
  }

  private beginSession(state: GameState): void {
    const newSession = this.activeGame !== state;
    if (newSession) {
      this.seenEventIds.clear();
      this.eventOrder.length = 0;
      this.particles.length = 0;
      this.visualTime = state.elapsed;
      this.playerVisual.propeller.rotation.z = 0;
      this.clearFlightVfx();
      for(const visual of this.enemyVisuals.values())this.scene.remove(visual.root);
      this.enemyVisuals.clear();
      this.lastVfxElapsed = state.elapsed;
    }
    this.activeGame = state;
    this.lastElapsed = state.elapsed;
    this.lastPhase = state.phase;
  }

  private updateAircraft(visual: AircraftVisual, aircraft: Aircraft, dt: number): void {
    // The separate wreck owns the falling model after destruction.
    visual.root.visible = aircraft.health > 0;
    visual.root.position.copy(aircraft.position);
    visual.root.quaternion.copy(aircraft.quaternion);
    visual.propeller.rotation.z = (visual.propeller.rotation.z + dt * (34 + Math.min(8, aircraft.speed * 0.035))) % (Math.PI * 2);
    const deflection = clamp(aircraft.bank * 0.34, -0.30, 0.30);
    visual.ailerons[0].rotation.x = deflection;
    visual.ailerons[1].rotation.x = -deflection;
    visual.elevator.rotation.x = clamp(-aircraft.pitch * 0.32, -0.26, 0.26);
  }

  private updateCamera(player: Aircraft, mode: GameMode): void {
    getFlightCameraPose(player, mode, this.camera.position, this.camera.quaternion);
    this.camera.updateMatrixWorld();
    const sight = projectGunSight(player, this.cssWidth, this.cssHeight);
    this.projectedAim.set(sight.x / this.cssWidth * 2 - 1, 1 - sight.y / this.cssHeight * 2, 0);
  }

  private updateEnemies(aircraft: Aircraft[], dt: number): void {
    const present = new Set<number>();
    for (const enemy of aircraft) {
      present.add(enemy.id);
      let visual = this.enemyVisuals.get(enemy.id);
      if (!visual) {
        visual = this.factory.create('enemy');
        this.addEnemyBand(visual);
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

  private addEnemyBand(visual: AircraftVisual): void {
    const band=new Mesh(this.teamBandGeometry,this.enemyBandMaterial);
    band.name='Kaisen enemy identification band';band.rotation.x=Math.PI/2;
    band.position.set(0,.04,2.45);band.scale.z=1.12;visual.root.add(band);
  }

  private updateWrecks(wrecks: GameState['wrecks'],motionDt:number): void {
    const present=new Set<number>();
    for(const wreck of wrecks){
      present.add(wreck.id);let entry=this.wreckVisuals.get(wreck.id);
      if(!entry){
        const existing=wreck.player?this.playerVisual:this.enemyVisuals.get(wreck.sourceId);
        const visual=existing??this.factory.create(wreck.player?'hero':'enemy');
        if(!existing&&!wreck.player)this.addEnemyBand(visual);
        if(!wreck.player)this.enemyVisuals.delete(wreck.sourceId);
        this.scene.add(visual.root);entry={visual};this.wreckVisuals.set(wreck.id,entry);
      }
      if(!wreck.player)entry.visual.propeller.rotation.z=(entry.visual.propeller.rotation.z+motionDt*(34+Math.min(8,wreck.speed*.035)))%(Math.PI*2);
      entry.visual.root.visible=wreck.age<5&&wreck.position.y>=0;
      entry.visual.root.position.copy(wreck.position);entry.visual.root.quaternion.copy(wreck.quaternion);
    }
    for(const [id,entry] of this.wreckVisuals)if(!present.has(id)){
      if(entry.visual!==this.playerVisual)this.scene.remove(entry.visual.root);else entry.visual.root.visible=false;
      this.wreckVisuals.delete(id);
    }
  }

  private clearFlightVfx():void{
    for(const entry of this.wreckVisuals.values())if(entry.visual!==this.playerVisual)this.scene.remove(entry.visual.root);
    this.wreckVisuals.clear();this.particles.length=0;this.particleGeometry.setDrawRange(0,0);
  }

  private updateClouds(position: Vector3): void {
    this.cloudPlane.position.set(position.x, 1850, position.z);
    this.cloudMaterial.uniforms.uTime.value = this.cloudTime;
    (this.cloudMaterial.uniforms.uCamera.value as Vector3).copy(this.camera.position);
  }

  private updateTracers(state: GameState): void {
    const count = Math.min(MAX_TRACERS, state.bullets.length);
    for (let i = 0; i < count; i++) {
      const bullet = state.bullets[i];
      const tail = bullet.position.clone().addScaledVector(bullet.velocity, -.025);
      this.tracerPositions.set([tail.x, tail.y, tail.z, bullet.position.x, bullet.position.y, bullet.position.z], i * 6);
      const color = bullet.owner === state.player.id ? [1, .83, .42] : [1, .32, .11];
      this.tracerColors.set([...color, ...color], i * 6);
    }
    this.tracerGeometry.setDrawRange(0, count * 2);
    this.tracerGeometry.attributes.position.needsUpdate = true;
    this.tracerGeometry.attributes.color.needsUpdate = true;
  }

  private collectEvents(events: GameEvent[]):void{
    for(const event of events){
      if(this.seenEventIds.has(event.id))continue;
      this.seenEventIds.add(event.id);this.eventOrder.push(event.id);
      if(this.eventOrder.length>2048){const old=this.eventOrder.shift();if(old!==undefined)this.seenEventIds.delete(old);}
      this.particles.push(...aircraftEventParticles(event,this.visualTime));
    }
    if(this.particles.length>AIRCRAFT_EFFECT_CAPACITY)this.particles.splice(0,this.particles.length-AIRCRAFT_EFFECT_CAPACITY);
  }

  private updateEffects(_dt:number):void{
    this.particles=this.particles.filter(p=>this.visualTime-p.born<p.life);
    this.particles.forEach((p,i)=>{
      const frame=sampleAircraftParticle(p,this.visualTime);
      this.particlePositions.set(frame.position.toArray(),i*3);
      this.particleColors.set([p.color.r,p.color.g,p.color.b],i*3);
      this.particleOpacity[i]=frame.opacity;this.particleSizes[i]=frame.size;
    });
    this.particleGeometry.setDrawRange(0,this.particles.length);
    for(const attribute of Object.values(this.particleGeometry.attributes))attribute.needsUpdate=true;
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
      aircraftParticles:this.particles.length, wreckModels:this.wreckVisuals.size, persistentDamageSmoke:0,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearFlightVfx();
    this.scene.remove(this.playerVisual.root);
    for (const visual of this.enemyVisuals.values()) this.scene.remove(visual.root);
    this.enemyVisuals.clear();
    this.scene.remove(this.cloudPlane,this.tracers,this.points);
    this.sky.dispose();this.cloudGeometry.dispose();this.cloudMaterial.dispose();
    this.tracerGeometry.dispose();this.tracerMaterial.dispose();
    this.particleGeometry.dispose();this.particleMaterial.dispose();
    this.teamBandGeometry.dispose();this.enemyBandMaterial.dispose();
    this.factory.dispose();
    this.renderer.dispose();
  }
}

