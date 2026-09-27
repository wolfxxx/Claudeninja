import * as THREE from "three";

/**
 * Ambient life: sunlit dust motes / pollen drifting around the player,
 * and flickering light from the stone lanterns.
 */
export class Atmosphere {
  private readonly motes: THREE.Points;
  private readonly count = 260;
  private readonly offsets: Float32Array;
  private readonly phases: Float32Array;
  private readonly lanterns: Array<{ light: THREE.PointLight; base: number; seed: number; mats: THREE.MeshStandardMaterial[] }> = [];
  private time = 0;
  private readonly radius = 16;

  constructor(private readonly scene: THREE.Scene) {
    const positions = new Float32Array(this.count * 3);
    this.offsets = new Float32Array(this.count * 3);
    this.phases = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.offsets[i * 3] = (Math.random() * 2 - 1) * this.radius;
      this.offsets[i * 3 + 1] = 0.3 + Math.random() * 5.5;
      this.offsets[i * 3 + 2] = (Math.random() * 2 - 1) * this.radius;
      this.phases[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("phase", new THREE.BufferAttribute(this.phases, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float phase;
        uniform float uTime;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Twinkle as they catch the light, and fade out close to the lens.
          float tw = 0.45 + 0.55 * sin(uTime * (0.8 + fract(phase) * 1.4) + phase * 7.0);
          vAlpha = tw * smoothstep(0.8, 3.0, -mv.z) * (1.0 - smoothstep(14.0, 22.0, -mv.z));
          gl_PointSize = (0.05 + 0.03 * fract(phase * 3.1)) * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = exp(-r * r * 4.0) * vAlpha;
          gl_FragColor = vec4(vec3(1.6, 1.35, 0.95) * a, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(geo, material);
    this.motes.frustumCulled = false;
    this.motes.name = "DustMotes";
    scene.add(this.motes);
  }

  setViewportHeight(px: number): void {
    (this.motes.material as THREE.ShaderMaterial).uniforms.uScale.value = px * 0.9;
  }

  /** Give every lantern in the loaded village a warm, flickering point light. */
  attachLanterns(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    const found: Array<{ pos: THREE.Vector3; mats: THREE.MeshStandardMaterial[] }> = [];
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const slots = Array.isArray(obj.material) ? obj.material : [obj.material];
      const glow = slots.filter(
        (m): m is THREE.MeshStandardMaterial =>
          m instanceof THREE.MeshStandardMaterial && /lantern_glow/i.test(m.name),
      );
      if (glow.length === 0 && !/lantern_glow/i.test(obj.name)) return;
      const box = new THREE.Box3().setFromObject(obj);
      const pos = box.getCenter(new THREE.Vector3());
      // Lanterns sharing a post merge into one light.
      const near = found.find((f) => f.pos.distanceTo(pos) < 1.2);
      if (near) near.mats.push(...glow);
      else found.push({ pos, mats: glow });
    });

    for (const { pos, mats } of found.slice(0, 6)) {
      for (const m of mats) m.emissiveIntensity = 2.6;
      const light = new THREE.PointLight(0xffa550, 5, 7, 1.6);
      light.position.copy(pos);
      light.castShadow = false;
      this.scene.add(light);
      this.lanterns.push({ light, base: 5, seed: Math.random() * 100, mats });
    }
  }

  update(delta: number, focus: THREE.Vector3): void {
    this.time += delta;
    const mat = this.motes.material as THREE.ShaderMaterial;
    mat.uniforms.uTime.value = this.time;

    // Motes live in a box that wraps around the player, so they're always nearby.
    const pos = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const r = this.radius;
    const wrap = (v: number) => ((((v + r) % (2 * r)) + 2 * r) % (2 * r)) - r;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      const ph = this.phases[i];
      this.offsets[k] += (0.18 + Math.sin(this.time * 0.3 + ph) * 0.12) * delta;
      this.offsets[k + 1] += Math.sin(this.time * 0.6 + ph * 2) * 0.08 * delta;
      this.offsets[k + 2] += Math.cos(this.time * 0.25 + ph) * 0.1 * delta;
      arr[k] = focus.x + wrap(this.offsets[k] - focus.x);
      arr[k + 1] = this.offsets[k + 1];
      arr[k + 2] = focus.z + wrap(this.offsets[k + 2] - focus.z);
    }
    pos.needsUpdate = true;

    for (const lantern of this.lanterns) {
      const t = this.time * 9 + lantern.seed;
      const flicker = 0.82 + Math.sin(t) * 0.07 + Math.sin(t * 2.7) * 0.06 + Math.sin(t * 0.43) * 0.05;
      lantern.light.intensity = lantern.base * flicker;
      for (const m of lantern.mats) m.emissiveIntensity = 2.6 * flicker;
    }
  }

  dispose(): void {
    this.scene.remove(this.motes);
    this.motes.geometry.dispose();
    (this.motes.material as THREE.Material).dispose();
    for (const { light } of this.lanterns) this.scene.remove(light);
  }
}
