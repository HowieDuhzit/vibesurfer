import * as THREE from "three";
import { Player } from "../entities/Player";

export class CameraController {
  private readonly lookAtTarget = new THREE.Vector3();

  public constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly player: Player
  ) {}

  public update(): void {
    this.lookAtTarget.copy(this.player.position);
    this.lookAtTarget.y += 0.2;
    this.lookAtTarget.z -= 4;
    this.camera.lookAt(this.lookAtTarget);
  }
}
