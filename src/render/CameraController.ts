import * as THREE from "three";
import { Player } from "../entities/Player";

export class CameraController {
  private readonly lookAtTarget = new THREE.Vector3();
  private readonly baseOffset = new THREE.Vector3(0, 4.2, 7.4);
  private readonly targetPosition = new THREE.Vector3();
  private readonly shakeOffset = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly blendedUp = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private lookAhead = 0;
  private baseFov: number;
  private fovPulseEnabled = true;
  private noiseTime = 0;
  private targetTrackBank = 0;
  private targetTrackLift = 0;
  private targetTrackPace = 0;
  private trackBank = 0;
  private trackLift = 0;
  private trackPace = 0;

  public constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly player: Player
  ) {
    this.baseFov = camera.fov;
  }

  public update(deltaTime = 0, shakeAmount = 0, fovPulse = 0): void {
    this.noiseTime += deltaTime;

    if (shakeAmount > 0) {
      this.shakeOffset.set(
        (Math.sin(this.noiseTime * 39.7) + Math.cos(this.noiseTime * 25.1)) * 0.03 * shakeAmount,
        Math.sin(this.noiseTime * 31.3) * 0.05 * shakeAmount,
        Math.cos(this.noiseTime * 17.7) * 0.03 * shakeAmount
      );
    } else {
      this.shakeOffset.set(0, 0, 0);
    }

    const smoothing = Math.min(1, deltaTime * 5);
    this.trackBank += (this.targetTrackBank - this.trackBank) * smoothing;
    this.trackLift += (this.targetTrackLift - this.trackLift) * smoothing;
    this.trackPace += (this.targetTrackPace - this.trackPace) * smoothing;
    this.lookAhead += ((0.9 + this.trackPace * 1.6) - this.lookAhead) * smoothing;

    this.player.getForward(this.forward);
    this.player.getUp(this.up);
    this.player.getRight(this.right);
    this.blendedUp.copy(this.worldUp).lerp(this.up, 0.58).normalize();

    const followDistance = this.baseOffset.z - this.trackPace * 1.1;
    const height = this.baseOffset.y + this.trackLift * 0.78;
    const lateral = this.trackBank * 0.7;

    this.targetPosition.copy(this.player.position)
      .addScaledVector(this.forward, -followDistance)
      .addScaledVector(this.blendedUp, height)
      .addScaledVector(this.right, lateral);
    this.targetPosition.add(this.shakeOffset);
    this.camera.position.lerp(this.targetPosition, Math.min(1, deltaTime * 4.2 || 1));
    const pulse = this.fovPulseEnabled ? Math.max(0, Math.min(1, fovPulse)) : 0;
    this.camera.fov = this.baseFov + pulse * 2.2 + this.trackPace * 2.4;
    this.camera.updateProjectionMatrix();
    this.lookAtTarget.copy(this.player.position)
      .addScaledVector(this.forward, 9.5 + this.trackPace * 2.5 + this.lookAhead)
      .addScaledVector(this.blendedUp, 0.45 + this.trackLift * 0.42)
      .addScaledVector(this.right, this.trackBank * 0.24);
    this.camera.up.lerp(this.blendedUp, Math.min(1, deltaTime * 5 || 1));
    this.camera.up.normalize();
    this.camera.lookAt(this.lookAtTarget);
  }

  public setFovPulseEnabled(enabled: boolean): void {
    this.fovPulseEnabled = enabled;
  }

  public setTrackMotion(curvature: number, elevation: number, pace: number): void {
    const clampedCurvature = Math.max(-1, Math.min(1, curvature));
    const clampedElevation = Math.max(0, Math.min(1, elevation));
    this.targetTrackBank = clampedCurvature * 0.11;
    this.targetTrackLift = clampedElevation * 0.28;
    this.targetTrackPace = Math.max(0, Math.min(1, pace));
  }
}
