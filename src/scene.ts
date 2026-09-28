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
import type { Aircraft, GameEvent, GameState } from './types';

type SceneStats = { calls: number; triangles: number; geometries: number; textures: number };
type VisualEvent = { id: number; position: Vector3; age: number; life: number; radius: number; color: Color };

const UP = new Vector3(0, 1, 0);
const CAMERA_OFFSET = new Vector3(0, 11, 29);
const LOOK_DOWN = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.19);
const MAX_TRACERS = 192;
const MAX_EFFECTS = 36;

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

function eventStyle(type: GameEvent['type']): { life: number; radius: number; color: number } {
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
  private readonly camera = new PerspectiveCamera(64, 1, 0.1, 6500);
  private readonly renderer: WebGLRenderer;
  private readonly factory = new AircraftFactory();
  private readonly playerVisual: AircraftVisual;
  private readonly enemyVisuals = new Map<number, AircraftVisual>();
  private readonly sky: CanvasTexture;
  private readonly cloudGeometry: PlaneGeometry;
  private readonly cloudMaterial: ShaderMaterial;
  private readonly cloudPlane: Mesh;
  private readonly tracerGeometry: CylinderGeometry;
  private readonly playerTracerMaterial: MeshBasicMaterial;
  private readonly enemyTracerMaterial: MeshBasicMaterial;
  private readonly playerTracers: InstancedMesh;
  private readonly enemyTracers: InstancedMesh;
  private readonly flashGeometry: SphereGeometry;
  private readonly ringGeometry: TorusGeometry;
  private readonly smokeGeometry: SphereGeometry;
  private readonly flashMaterial: MeshBasicMaterial;
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly smokeMaterial: MeshBasicMaterial;
  private readonly flashes: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly smoke: InstancedMesh;
  private readonly seenEventIds = new Set<number>();
  private readonly eventOrder: number[] = [];
  private readonly effects: VisualEvent[] = [];
  private readonly dummy = new Object3D();
  private readonly tempColor = new Color();
  private readonly direction = new Vector3();
  private readonly cameraOffset = CAMERA_OFFSET.clone();
  private readonly aimWorld = new Vector3();
  private readonly projectedAim = new Vector3();
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

    this.tracerGeometry = new CylinderGeometry(0.011, 0.038, 1, 6, 1, false);
    this.playerTracerMaterial = new MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.92,
      depthWrite: false, blending: AdditiveBlending,
    });
    this.enemyTracerMaterial = new MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.8,
      depthWrite: false, blending: AdditiveBlending,
    });
    this.playerTracers = new InstancedMesh(this.tracerGeometry, this.playerTracerMaterial, MAX_TRACERS);
    this.enemyTracers = new InstancedMesh(this.tracerGeometry, this.enemyTracerMaterial, MAX_TRACERS);
    this.playerTracers.frustumCulled = false;
    this.enemyTracers.frustumCulled = false;
    this.playerTracers.visible = false;
    this.enemyTracers.visible = false;
    this.playerTracers.renderOrder = 2;
    this.enemyTracers.renderOrder = 2;
    this.scene.add(this.playerTracers, this.enemyTracers);

    this.flashGeometry = new SphereGeometry(1, 10, 7);
    this.ringGeometry = new TorusGeometry(1, 0.035, 5, 28);
    this.smokeGeometry = new SphereGeometry(1, 9, 6);
    this.flashMaterial = new MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.76,
      depthWrite: false, blending: AdditiveBlending,
    });
    this.ringMaterial = new MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.82,
      depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    });
    this.smokeMaterial = new MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.30,
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
    this.updateCamera(state.player, state.enemies);
    this.updateEnemies(state.enemies, motionDt);
    this.updateClouds(state.player.position);
    this.updateTracers(state);
    this.collectEvents(state.events);
    this.updateEffects(motionDt);
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

  private updateCamera(player: Aircraft, enemies: Aircraft[]): void {
    this.cameraOffset.copy(CAMERA_OFFSET).applyQuaternion(player.quaternion);
    this.camera.position.copy(player.position).add(this.cameraOffset);
    this.camera.quaternion.copy(player.quaternion).multiply(LOOK_DOWN);
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
      if (this.direction.lengthSq() < 1e-7) this.direction.copy(bullet.velocity);
      if (this.direction.lengthSq() < 1e-7) this.direction.set(0, 0, -1);
      this.direction.normalize();
      const length = bullet.kind === 'cannon' ? 1.12 : 0.78;
      this.dummy.position.copy(bullet.position).addScaledVector(this.direction, -length * 0.27);
      this.dummy.quaternion.setFromUnitVectors(UP, this.direction);
      this.dummy.scale.set(bullet.kind === 'cannon' ? 1.5 : 1, length, bullet.kind === 'cannon' ? 1.5 : 1);
      this.dummy.updateMatrix();
      if (playerShot) {
        this.playerTracers.setMatrixAt(playerCount, this.dummy.matrix);
        playerColor.setHex(bullet.kind === 'cannon' ? 0xfff0bd : 0xf8d498);
        this.playerTracers.setColorAt(playerCount++, playerColor);
      } else {
        this.enemyTracers.setMatrixAt(enemyCount, this.dummy.matrix);
        enemyColor.setHex(bullet.kind === 'cannon' ? 0xffc094 : 0xf17a68);
        this.enemyTracers.setColorAt(enemyCount++, enemyColor);
      }
    }
    this.playerTracers.count = playerCount;
    this.enemyTracers.count = enemyCount;
    this.playerTracers.visible = playerCount > 0;
    this.enemyTracers.visible = enemyCount > 0;
    if (playerCount) {
      this.playerTracers.instanceMatrix.needsUpdate = true;
      if (this.playerTracers.instanceColor) this.playerTracers.instanceColor.needsUpdate = true;
    }
    if (enemyCount) {
      this.enemyTracers.instanceMatrix.needsUpdate = true;
      if (this.enemyTracers.instanceColor) this.enemyTracers.instanceColor.needsUpdate = true;
    }
  }

  private collectEvents(events: GameEvent[]): void {
    for (const event of events) {
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
    this.scene.remove(this.playerVisual.root);
    for (const visual of this.enemyVisuals.values()) this.scene.remove(visual.root);
    this.enemyVisuals.clear();
    this.scene.remove(this.cloudPlane, this.playerTracers, this.enemyTracers, this.flashes, this.rings, this.smoke);
    this.sky.dispose();
    this.cloudGeometry.dispose();
    this.cloudMaterial.dispose();
    this.tracerGeometry.dispose();
    this.playerTracerMaterial.dispose();
    this.enemyTracerMaterial.dispose();
    this.flashGeometry.dispose();
    this.ringGeometry.dispose();
    this.smokeGeometry.dispose();
    this.flashMaterial.dispose();
    this.ringMaterial.dispose();
    this.smokeMaterial.dispose();
    this.factory.dispose();
    this.renderer.dispose();
  }
}
