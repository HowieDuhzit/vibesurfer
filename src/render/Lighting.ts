import * as THREE from "three";

export class Lighting {
  public readonly ambient = new THREE.AmbientLight(0x9cc8ff, 0.26);
  public readonly hemi = new THREE.HemisphereLight(0x93c5fd, 0x020617, 0.42);
  public readonly directional = new THREE.DirectionalLight(0xdbeafe, 1.25);
  public readonly fill = new THREE.DirectionalLight(0x7dd3fc, 0.48);
  public readonly rim = new THREE.PointLight(0x67e8f9, 1.6, 28, 2);

  public constructor(scene: THREE.Scene) {
    this.directional.position.set(5, 10, 7);
    this.directional.castShadow = true;
    this.directional.shadow.mapSize.set(1024, 1024);
    this.directional.shadow.bias = -0.00015;

    this.fill.position.set(-8, 3, -7);

    this.rim.position.set(0, 2.4, 4);

    scene.add(this.ambient);
    scene.add(this.hemi);
    scene.add(this.directional);
    scene.add(this.fill);
    scene.add(this.rim);
  }
}
