import * as THREE from "three";

export abstract class Entity {
  public active = true;
  public readonly mesh: THREE.Object3D;

  protected constructor(mesh: THREE.Object3D) {
    this.mesh = mesh;
  }
}
