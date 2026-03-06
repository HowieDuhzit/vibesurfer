import * as THREE from "three";
import { Player } from "../entities/Player";

export class CameraController {
  private readonly lookAtTarget = new THREE.Vector3();
  private readonly basePosition = new THREE.Vector3(0, 4, 6);
  private readonly shakeOffset = new THREE.Vector3();
  private baseFov: number;
  private fovPulseEnabled = true;
  private noiseTime = 0;

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

    this.camera.position.copy(this.basePosition).add(this.shakeOffset);
    const pulse = this.fovPulseEnabled ? Math.max(0, Math.min(1, fovPulse)) : 0;
    this.camera.fov = this.baseFov + pulse * 2.8;
    this.camera.updateProjectionMatrix();
    this.lookAtTarget.copy(this.player.position);
    this.lookAtTarget.y += 0.2;
    this.lookAtTarget.z -= 4;
    this.camera.lookAt(this.lookAtTarget);
  }

  public setFovPulseEnabled(enabled: boolean): void {
    this.fovPulseEnabled = enabled;
  }
}
