import * as THREE from "three";

type Burst = {
  mesh: THREE.Mesh | THREE.Sprite;
  age: number;
  life: number;
  start: number;
  end: number;
  opacity: number;
  /** Metres per second upward drift (damage numbers). */
  rise?: number;
  /** Owned texture to dispose with the burst. */
  texture?: THREE.Texture;
};

/**
 * Pooled GPU particles: one Points draw call per blend mode.
 * Each particle has its own size, colour and life; dead slots are recycled.
 */
class ParticlePool {
  readonly points: THREE.Points;
  private readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;

  constructor(capacity: number, additive: boolean) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.age = new Float32Array(capacity).fill(1);
    this.baseSize = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.pos.fill(-9999);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uSoft: { value: additive ? 1 : 0 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uSoft;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          if (r > 1.0) discard;
          // Sparks: hot core with a soft halo. Dust: a fuzzy disc.
          float core = mix(1.0 - smoothstep(0.35, 1.0, r), exp(-r * r * 3.5), uSoft);
          gl_FragColor = vec4(vColor, core * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  setViewportHeight(px: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = px * 0.9;
  }

  emit(
    at: THREE.Vector3,
    vx: number,
    vy: number,
    vz: number,
    color: THREE.Color,
    size: number,
    life: number,
    gravity: number,
    drag: number,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos.set([at.x, at.y, at.z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.baseSize[i] = size;
    this.life[i] = life;
    this.age[i] = 0;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
  }

  update(delta: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i] += delta;
      const t = Math.min(this.age[i] / this.life[i], 1);
      const k = i * 3;
      const damp = Math.exp(-this.drag[i] * delta);
      this.vel[k] *= damp;
      this.vel[k + 2] *= damp;
      this.vel[k + 1] = this.vel[k + 1] * damp - this.gravity[i] * delta;
      this.pos[k] += this.vel[k] * delta;
      this.pos[k + 1] = Math.max(0.02, this.pos[k + 1] + this.vel[k + 1] * delta);
      this.pos[k + 2] += this.vel[k + 2] * delta;
      this.alpha[i] = (1 - t) * (1 - t);
      // Sparks shrink as they cool; dust (negative gravity) swells as it spreads.
      this.size[i] = this.baseSize[i] * (this.gravity[i] < 0 ? 0.6 + t * 1.2 : 1 - t * 0.6);
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

let flashTex: THREE.Texture | null = null;
function flashTexture(): THREE.Texture {
  if (flashTex) return flashTex;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,240,210,0.7)");
    g.addColorStop(1, "rgba(255,200,140,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  flashTex = new THREE.CanvasTexture(canvas);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}

const tmpColor = new THREE.Color();
const tmpVec = new THREE.Vector3();

/** Short, readable attack cues built from geometry and particles, with no extra downloads. */
export class CombatEffects {
  private readonly bursts: Burst[] = [];
  private readonly sparks = new ParticlePool(700, true);
  private readonly dustPool = new ParticlePool(500, false);

  constructor(private readonly scene: THREE.Scene) {
    scene.add(this.sparks.points, this.dustPool.points);
  }

  setViewportHeight(px: number): void {
    this.sparks.setViewportHeight(px);
    this.dustPool.setViewportHeight(px);
  }

  roundhouse(at: THREE.Vector3, facing: number): void {
    const geometry = new THREE.TorusGeometry(1.5, 0.065, 6, 48, Math.PI * 1.65);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.6, 1.1, 0.6),
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.set(-Math.PI / 2, 0, facing - Math.PI * 0.82);
    mesh.position.copy(at).add(new THREE.Vector3(0, 1.05, 0));
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0, life: 0.28, start: 0.8, end: 1.4, opacity: 0.78 });
  }

  /** A short bright streak in front of the fist. */
  jab(at: THREE.Vector3, facing: number): void {
    const geometry = new THREE.TorusGeometry(0.9, 0.04, 5, 24, Math.PI * 0.55);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2, 1.7, 1.2),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.set(-Math.PI / 2, 0, facing - Math.PI * 0.27 - Math.PI / 2);
    mesh.position.copy(at).add(new THREE.Vector3(Math.sin(facing) * 0.4, 1.25, Math.cos(facing) * 0.4));
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0, life: 0.16, start: 0.7, end: 1.25, opacity: 0.7 });
  }

  slam(at: THREE.Vector3): void {
    for (const [color, delay, end] of [[0xffc46c, 0, 3.5], [0xffede0, -0.07, 2.7]] as const) {
      const geometry = new THREE.RingGeometry(0.88, 1.05, 64);
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(1.8),
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.copy(at);
      mesh.position.y += 0.07;
      this.scene.add(mesh);
      this.bursts.push({ mesh, age: delay, life: 0.48, start: 0.25, end, opacity: 0.75 });
    }
    // Debris kicked outward from the crater.
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 5;
      tmpColor.setHSL(0.08, 0.25, 0.45 + Math.random() * 0.15, THREE.SRGBColorSpace);
      tmpVec.copy(at).setY(at.y + 0.15);
      this.dustPool.emit(tmpVec, Math.cos(a) * s, 1 + Math.random() * 2.5, Math.sin(a) * s, tmpColor, 0.5, 0.7 + Math.random() * 0.4, -0.4, 3.2);
    }
  }

  /**
   * Impact at a struck enemy: spark spray, a white-hot flash and, for heavy blows, a shock ring.
   * `power` ~1 for a jab, ~2 for a finisher, ~3 for a counter/kill.
   */
  hit(at: THREE.Vector3, from: THREE.Vector3, power: number, counter: boolean): void {
    const dirX = at.x - from.x;
    const dirZ = at.z - from.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = dirX / len;
    const nz = dirZ / len;
    const count = Math.round(14 + power * 12);
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 2.2;
      const s = 4 + Math.random() * 7 * (0.7 + power * 0.3);
      const vx = (nx - nz * spread) * s;
      const vz = (nz + nx * spread) * s;
      const vy = 1 + Math.random() * 5;
      if (counter) tmpColor.setRGB(0.6 + Math.random() * 0.4, 1.4, 2.6);
      else tmpColor.setRGB(2.6, 1.3 + Math.random() * 0.8, 0.4 + Math.random() * 0.3);
      this.sparks.emit(at, vx, vy, vz, tmpColor, 0.09 + Math.random() * 0.07, 0.25 + Math.random() * 0.3, 14, 2.5);
    }
    // A few slow embers that hang in the air.
    for (let i = 0; i < 6 * power; i++) {
      tmpColor.setRGB(counter ? 0.8 : 2.2, counter ? 1.4 : 0.9, counter ? 2.4 : 0.35);
      tmpVec.set(at.x + (Math.random() - 0.5) * 0.4, at.y + (Math.random() - 0.5) * 0.4, at.z + (Math.random() - 0.5) * 0.4);
      this.sparks.emit(tmpVec, (Math.random() - 0.5) * 2, 0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2, tmpColor, 0.06, 0.8 + Math.random() * 0.6, 1.2, 1.5);
    }

    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: flashTexture(),
        color: counter ? new THREE.Color(0.8, 1.4, 2.2) : new THREE.Color(2, 1.6, 1.1),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    flash.position.copy(at);
    flash.renderOrder = 7;
    this.scene.add(flash);
    this.bursts.push({ mesh: flash, age: 0, life: 0.1 + power * 0.025, start: 0.35 + power * 0.15, end: 0.8 + power * 0.3, opacity: 0.85 });

    if (power >= 2) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 48),
        new THREE.MeshBasicMaterial({
          color: counter ? new THREE.Color(1, 1.8, 3) : new THREE.Color(2.6, 1.8, 1),
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      ring.position.copy(at);
      ring.lookAt(from.x, at.y, from.z);
      this.scene.add(ring);
      this.bursts.push({ mesh: ring, age: 0, life: 0.3, start: 0.2, end: 1.6 + power * 0.3, opacity: 0.8 });
    }
  }

  /** Brush-stroke damage number that pops and drifts up. */
  damageNumber(at: THREE.Vector3, value: number, style: "normal" | "heavy" | "counter" | "kill"): void {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const label = style === "kill" ? "撃破" : String(value);
    const fill = style === "counter" ? "#9fdcff" : style === "kill" ? "#ff5a3c" : style === "heavy" ? "#ffcf6a" : "#fff4e6";
    ctx.font = `900 ${style === "normal" ? 64 : 80}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 12;
    ctx.strokeStyle = "rgba(20,8,6,0.9)";
    ctx.strokeText(label, 128, 64);
    ctx.fillStyle = fill;
    ctx.fillText(label, 128, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true }),
    );
    sprite.position.set(at.x + (Math.random() - 0.5) * 0.5, at.y + 0.5, at.z + (Math.random() - 0.5) * 0.5);
    sprite.renderOrder = 12;
    const base = style === "normal" ? 0.95 : 1.25;
    sprite.scale.set(0, 0, 1);
    this.scene.add(sprite);
    this.bursts.push({ mesh: sprite, age: 0, life: 0.9, start: base * 1.8, end: base * 1.2, opacity: 1, rise: 1.4, texture });
  }

  /** Blue wisps curling off the player while a counter is primed. */
  aura(at: THREE.Vector3): void {
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      tmpVec.set(at.x + Math.cos(a) * 0.35, at.y + 0.3 + Math.random() * 1.3, at.z + Math.sin(a) * 0.35);
      tmpColor.setRGB(0.5, 1.1, 2.4);
      this.sparks.emit(tmpVec, Math.cos(a) * 0.3, 1.2 + Math.random(), Math.sin(a) * 0.3, tmpColor, 0.08, 0.5 + Math.random() * 0.3, -0.5, 1.5);
    }
  }

  /** Puffs of dust at the feet: rolls, landings, sprint pushes. */
  dust(at: THREE.Vector3, amount: number): void {
    const count = Math.round(8 + amount * 10);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.8 + Math.random() * 1.8) * (0.6 + amount * 0.5);
      tmpColor.setHSL(0.09, 0.22, 0.62 + Math.random() * 0.12, THREE.SRGBColorSpace);
      tmpVec.set(at.x + Math.cos(a) * 0.25, at.y + 0.1 + Math.random() * 0.15, at.z + Math.sin(a) * 0.25);
      this.dustPool.emit(tmpVec, Math.cos(a) * s, 0.4 + Math.random() * 0.8, Math.sin(a) * s, tmpColor, 0.35 + amount * 0.2, 0.6 + Math.random() * 0.5, -0.3, 2.8);
    }
  }

  update(delta: number): void {
    this.sparks.update(delta);
    this.dustPool.update(delta);
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.age += delta;
      const progress = THREE.MathUtils.clamp(burst.age / burst.life, 0, 1);
      if (progress >= 1) {
        this.removeBurst(burst);
        this.bursts.splice(i, 1);
        continue;
      }
      const material = burst.mesh.material as THREE.MeshBasicMaterial | THREE.SpriteMaterial;
      if (burst.rise !== undefined) {
        // Pop in fast, settle, then fade in the last third.
        const pop = progress < 0.15 ? progress / 0.15 : 1;
        const scale = THREE.MathUtils.lerp(burst.start, burst.end, Math.min(progress / 0.3, 1)) * pop;
        // The label canvas is 2:1.
        burst.mesh.scale.set(scale * 1.1, scale * 0.55, 1);
        burst.mesh.position.y += burst.rise * delta * (1 - progress);
        material.opacity = progress < 0.65 ? 1 : 1 - (progress - 0.65) / 0.35;
        continue;
      }
      const scale = THREE.MathUtils.lerp(burst.start, burst.end, progress);
      burst.mesh.scale.setScalar(scale);
      material.opacity = burst.opacity * (1 - progress) ** 1.5;
    }
  }

  dispose(): void {
    for (const burst of this.bursts) this.removeBurst(burst);
    this.bursts.length = 0;
    this.scene.remove(this.sparks.points, this.dustPool.points);
    this.sparks.dispose();
    this.dustPool.dispose();
  }

  private removeBurst(burst: Burst): void {
    this.scene.remove(burst.mesh);
    if (burst.mesh instanceof THREE.Mesh) burst.mesh.geometry.dispose();
    (burst.mesh.material as THREE.Material).dispose();
    burst.texture?.dispose();
  }
}
