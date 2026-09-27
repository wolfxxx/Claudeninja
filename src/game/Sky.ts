import * as THREE from "three";

/** Late-afternoon palette shared by the sky dome, fog and lights. */
export const SKY = {
  zenith: new THREE.Color(0x3d78c2),
  horizon: new THREE.Color(0xf0d2ac),
  ground: new THREE.Color(0xcfae88),
  sun: new THREE.Color(0xffd79a),
  /** Direction *toward* the sun (normalised). */
  sunDir: new THREE.Vector3(0.62, 0.42, 0.66).normalize(),
  fog: new THREE.Color(0xe6c9a4),
} as const;

/**
 * Gradient dome with a soft sun, a warm horizon haze band and slow painterly clouds.
 * Follows the camera so it never clips against the far plane.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: {
    uTime: { value: number };
    uZenith: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
    uGround: { value: THREE.Color };
    uSun: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
  };

  constructor() {
    this.uniforms = {
      uTime: { value: 0 },
      uZenith: { value: SKY.zenith.clone() },
      uHorizon: { value: SKY.horizon.clone() },
      uGround: { value: SKY.ground.clone() },
      uSun: { value: SKY.sun.clone() },
      uSunDir: { value: SKY.sunDir.clone() },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGround;
        uniform vec3 uSun;
        uniform vec3 uSunDir;
        varying vec3 vDir;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
          return v;
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          // Peach haze -> pale blue -> deep blue, avoiding the grey a straight mix gives.
          float up = clamp(h, 0.0, 1.0);
          vec3 mid = mix(uZenith, vec3(0.75, 0.86, 1.0), 0.55);
          vec3 col = mix(uHorizon, mid, smoothstep(0.0, 0.22, up));
          col = mix(col, uZenith, smoothstep(0.18, 0.75, up));
          // Below the horizon: fade into the warm ground haze.
          col = mix(col, uGround, smoothstep(0.0, -0.25, h));

          // Sun: tight disc, warm glow, and a broad forward-scatter bloom.
          float s = max(dot(d, uSunDir), 0.0);
          col += uSun * (pow(s, 900.0) * 6.0 + pow(s, 60.0) * 0.55 + pow(s, 6.0) * 0.22);

          // Clouds: projected onto a flat layer, drifting slowly.
          if (h > 0.02) {
            vec2 uv = d.xz / (h + 0.08) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
            float c = fbm(uv * 1.3);
            c = smoothstep(0.52, 0.82, c) * smoothstep(0.02, 0.25, h);
            vec3 cloudCol = mix(vec3(1.0, 0.93, 0.85), uSun * 1.1, pow(s, 4.0) * 0.6);
            // Underside shading makes them read as volumes.
            float shade = 0.82 + 0.18 * fbm(uv * 2.6 + 3.0);
            col = mix(col, cloudCol * shade, c * 0.78);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), material);
    this.mesh.name = "SkyDome";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(delta: number, camera: THREE.Camera): void {
    this.uniforms.uTime.value += delta;
    this.mesh.position.copy(camera.position);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
