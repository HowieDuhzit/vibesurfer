import * as THREE from "three";

export class SceneManager {
  public constructor(public readonly scene: THREE.Scene) {}

  public add(object: THREE.Object3D): void {
    this.scene.add(object);
  }
}
