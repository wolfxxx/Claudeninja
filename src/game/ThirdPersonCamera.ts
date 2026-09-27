import * as THREE from "three";
import {
  CAMERA_FOLLOW,
  LOOK_SENSITIVITY,
  PITCH_MAX,
  PITCH_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SMOOTH,
  ZOOM_STEP,
} from "./constants";
import type { Player } from "./Player";

/**
 * Orbit camera: spherical yaw/pitch/distance around the player, with a
 * lagged follow so motion feels cinematic instead of glued to the capsule.
 */
export class ThirdPersonCamera {
  /** Horizontal orbit angle (radians). 0 = camera on +Z, looking toward the village. */
  private yaw = 0;

  /** Elevation above the horizon (radians). Positive = camera above the player. */
  private pitch = 0.34;

  private distance = 7.2;
  private targetDistance = 7.2;

  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly sphericalOffset = new THREE.Vector3();

  /** 0–1 shake budget; the visible shake is trauma², so small knocks stay subtle. */
  private trauma = 0;
  private shakeTime = 0;
  private readonly baseFov: number;
  private fovKick = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly player: Player,
  ) {
    this.baseFov = camera.fov;
    this.syncImmediate();
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Brief zoom-in punch on big hits (negative = narrower FOV). */
  kickFov(degrees: number): void {
    this.fovKick = degrees;
  }

  update(delta: number, lookDX: number, lookDY: number, wheel: number, sprinting = false): void {
    this.yaw -= lookDX * LOOK_SENSITIVITY;
    // Mouse up (negative movementY) decreases pitch → camera drops, you look up.
    this.pitch += lookDY * LOOK_SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch, PITCH_MIN, PITCH_MAX);

    if (wheel !== 0) {
      this.targetDistance = THREE.MathUtils.clamp(
        this.targetDistance + wheel * ZOOM_STEP,
        ZOOM_MIN,
        ZOOM_MAX,
      );
    }

    const zoomT = 1 - Math.exp(-ZOOM_SMOOTH * delta);
    this.distance = THREE.MathUtils.lerp(this.distance, this.targetDistance, zoomT);

    this.computeDesiredPosition();

    const followT = 1 - Math.exp(-CAMERA_FOLLOW * delta);
    this.camera.position.lerp(this.desired, followT);

    this.player.getLookAtPoint(this.lookAt);
    this.camera.lookAt(this.lookAt);
    this.applyShake(delta);

    // Widen a touch while sprinting for a sense of speed; hit punches ease back out.
    this.fovKick *= Math.exp(-7 * delta);
    const fov = this.baseFov + (sprinting ? 6 : 0) + this.fovKick;
    const next = THREE.MathUtils.lerp(this.camera.fov, fov, 1 - Math.exp(-6 * delta));
    if (Math.abs(next - this.camera.fov) > 0.01) {
      this.camera.fov = next;
      this.camera.updateProjectionMatrix();
    }
  }

  private applyShake(delta: number): void {
    this.trauma = Math.max(0, this.trauma - delta * 1.8);
    if (this.trauma <= 0) return;
    this.shakeTime += delta;
    const shake = this.trauma * this.trauma;
    const t = this.shakeTime * 32;
    // Cheap smooth noise: sums of incommensurate sines.
    const n = (seed: number) => Math.sin(t * 1.0 + seed) * 0.6 + Math.sin(t * 2.3 + seed * 3.1) * 0.4;
    this.camera.rotateX(n(1.7) * 0.022 * shake);
    this.camera.rotateY(n(4.2) * 0.022 * shake);
    this.camera.rotateZ(n(8.9) * 0.035 * shake);
  }

  /** Snap without lag — used on init so the first frame isn't behind. */
  syncImmediate(): void {
    this.computeDesiredPosition();
    this.camera.position.copy(this.desired);
    this.player.getLookAtPoint(this.lookAt);
    this.camera.lookAt(this.lookAt);
  }

  /**
   * Convert yaw/pitch/distance into a world-space camera point.
   *
   *   x = sin(yaw) * cos(pitch) * distance
   *   y = sin(pitch) * distance
   *   z = cos(yaw) * cos(pitch) * distance
   *
   * Pitch is measured from the horizon so zoom stays consistent as you look up/down.
   */
  private computeDesiredPosition(): void {
    const cosPitch = Math.cos(this.pitch);
    this.sphericalOffset.set(
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch,
    );
    this.sphericalOffset.multiplyScalar(this.distance);

    this.player.getLookAtPoint(this.lookAt);
    this.desired.copy(this.lookAt).add(this.sphericalOffset);
  }
}
