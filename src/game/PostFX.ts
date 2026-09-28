import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/**
 * Colour grade applied in linear HDR before tone mapping:
 * warm split-tone, gentle contrast, vignette, and the blue "shadow step" tint
 * used while time is slowed after a perfect dodge.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSaturation: { value: 1.15 },
    uVignette: { value: 0.32 },
    uFocus: { value: 0 },
    uHurt: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uFocus;
    uniform float uHurt;
    uniform float uAspect;
    varying vec2 vUv;

    void main() {
      vec2 centered = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r = length(centered);

      // Shadow step: a slight radial smear toward the centre sells slowed time.
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (uFocus > 0.001) {
        vec2 dir = (vUv - 0.5) * 0.006 * uFocus;
        col = col * 0.4 + texture2D(tDiffuse, vUv - dir).rgb * 0.3 + texture2D(tDiffuse, vUv - dir * 2.0).rgb * 0.3;
      }

      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float sat = uSaturation * (1.0 - uFocus * 0.75);
      col = mix(vec3(luma), col, sat);

      // Warm highlights, cooler shadows.
      vec3 warm = vec3(1.04, 1.0, 0.94);
      vec3 cool = vec3(0.93, 0.97, 1.06);
      col *= mix(cool, warm, smoothstep(0.05, 0.6, luma));

      // Shadow step tint: ink-blue world with bright edges.
      col = mix(col, vec3(luma) * vec3(0.55, 0.75, 1.25), uFocus * 0.55);

      float vig = smoothstep(0.35, 0.95, r);
      col *= 1.0 - vig * (uVignette + uFocus * 0.35);
      col = mix(col, col * vec3(1.4, 0.35, 0.3), vig * uHurt);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  readonly composer: EffectComposer;
  enabled = true;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private focus = 0;
  private focusTarget = 0;
  private hurt = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    // Only genuinely hot pixels (sun, lanterns, sparks) bloom.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.5, 1.05);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  /** 0–1: how deep into the perfect-dodge slow-motion look we are. */
  setFocus(target: number): void {
    this.focusTarget = target;
  }

  flashHurt(): void {
    this.hurt = 1;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.bloom.resolution.set((width * pixelRatio) / 2, (height * pixelRatio) / 2);
    this.grade.uniforms.uAspect.value = width / Math.max(height, 1);
  }

  render(delta: number): void {
    this.focus = THREE.MathUtils.lerp(this.focus, this.focusTarget, 1 - Math.exp(-10 * delta));
    this.hurt = Math.max(0, this.hurt - delta * 2.4);
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.grade.uniforms.uFocus.value = this.focus;
    this.grade.uniforms.uHurt.value = this.hurt * 0.8;
    this.composer.render(delta);
  }

  /**
   * Get objects that are not in the scene yet ready to appear without a stall.
   * Shaders are compiled for both paths that can draw them: the linear HDR target
   * (effects on) and the screen (effects off), since three.js keys programs on the
   * render target bound at compile time. Then the objects are drawn once off-screen,
   * with the scene's lights and shadows, because drivers still do per-program setup
   * on the first real draw.
   */
  async prewarm(root: THREE.Object3D): Promise<void> {
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer.readBuffer);
    const hdr = this.renderer.compileAsync(root, this.camera, this.scene);
    this.renderer.setRenderTarget(null);
    const screen = this.renderer.compileAsync(root, this.camera, this.scene);
    this.renderer.setRenderTarget(previous);
    await Promise.all([hdr, screen]);

    const target = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
    // In front of the camera so frustum culling keeps every part in the draw.
    root.position.copy(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(4)).add(this.camera.position);
    this.scene.add(root);
    const current = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(current);
    this.scene.remove(root);
    target.dispose();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
