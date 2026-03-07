import * as THREE from "three";
import { Player } from "../entities/Player";

export class ComboRingEffect {
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly color = new THREE.Color();
  private spin = 0;

  public constructor(scene: THREE.Scene, private readonly player: Player) {
    const geometry = new THREE.TorusGeometry(1.08, 0.06, 10, 48);
    this.material = new THREE.MeshStandardMaterial({
      color: 0x60a5fa,
      emissive: 0x60a5fa,
      emissiveIntensity: 0.7,
      metalness: 0.2,
      roughness: 0.3
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.x = Math.PI * 0.5;
    scene.add(this.mesh);
  }

  public update(deltaTime: number, combo: number, energy: number): void {
    this.mesh.position.set(this.player.position.x, this.player.position.y - 0.22, this.player.position.z + 0.2);
    const comboNorm = Math.min(1, combo / 40);
    const targetScale = 0.9 + comboNorm * 0.7;

    this.mesh.scale.x += (targetScale - this.mesh.scale.x) * Math.min(1, deltaTime * 7);
    this.mesh.scale.y = this.mesh.scale.x;
    this.mesh.scale.z = this.mesh.scale.x;
    this.spin += deltaTime * (0.7 + comboNorm * 2.0);
    this.mesh.rotation.x = Math.PI * 0.5 + this.player.mesh.rotation.x * 0.45;
    this.mesh.rotation.y = this.player.mesh.rotation.y;
    this.mesh.rotation.z = this.player.mesh.rotation.z + this.spin;

    this.color.setHSL(0.55 - comboNorm * 0.22, 0.92, 0.55 + energy * 0.15);
    this.material.color.copy(this.color);
    this.material.emissive.copy(this.color);
    this.material.emissiveIntensity = 0.35 + comboNorm * 1.8;
  }
}
