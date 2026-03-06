import * as THREE from "three";

export class Lighting {
  public readonly ambient = new THREE.AmbientLight(0xffffff, 0.35);
  public readonly directional = new THREE.DirectionalLight(0xdbeafe, 1.0);

  public constructor(scene: THREE.Scene) {
    this.directional.position.set(4, 8, 6);
    this.directional.castShadow = true;

    scene.add(this.ambient);
    scene.add(this.directional);
  }
}
