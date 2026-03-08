import * as THREE from "three";
import { Player } from "../entities/Player";

export class CameraController {
  private readonly lookAtTarget = new THREE.Vector3();
  private readonly baseOffset = new THREE.Vector3(0, 4.2, 7.4);
  private readonly targetPosition = new THREE.Vector3();
  private readonly shakeOffset = new THREE.Vector3();
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

    this.targetPosition.copy(this.player.position).add(this.baseOffset);
    this.targetPosition.x += this.trackBank * 0.8;
    this.targetPosition.y += this.trackLift * 0.75;
    this.targetPosition.z += 0.6 - this.trackPace * 0.55;
    this.targetPosition.add(this.shakeOffset);
    this.camera.position.lerp(this.targetPosition, Math.min(1, deltaTime * 5.5 || 1));
    const pulse = this.fovPulseEnabled ? Math.max(0, Math.min(1, fovPulse)) : 0;
    this.camera.fov = this.baseFov + pulse * 2.2 + this.trackPace * 1.3;
    this.camera.updateProjectionMatrix();
    this.lookAtTarget.copy(this.player.position);
    this.lookAtTarget.y += 0.45 + this.trackLift * 0.3;
    this.lookAtTarget.x += this.trackBank * 0.25;
    this.lookAtTarget.z -= 10 + this.trackPace * 1.4;
    this.camera.lookAt(this.lookAtTarget);
  }

  public setFovPulseEnabled(enabled: boolean): void {
    this.fovPulseEnabled = enabled;
  }

  public setTrackMotion(curvature: number, elevation: number, pace: number): void {
    this.targetTrackBank = Math.max(-1, Math.min(1, curvature)) * 0.16;
    this.targetTrackLift = Math.max(0, Math.min(1, elevation)) * 0.4;
    this.targetTrackPace = Math.max(0, Math.min(1, pace));
  }
}
